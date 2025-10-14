import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import { cpus } from "node:os";
import * as path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { transformHeader } from "../tar/options";
import type { TarHeader } from "../tar/types";
import { createTarUnpacker } from "../tar/unpacker";
import { normalizeHeaderName, normalizeUnicode, validateBounds } from "./path";
import type { UnpackOptionsFS } from "./types";

/**
 * Extract a tar archive to a directory.
 *
 * Returns a Node.js [`Writable`](https://nodejs.org/api/stream.html#class-streamwritable)
 * stream to pipe tar archive bytes into. Files, directories, symlinks, and hardlinks
 * are written to the filesystem with correct permissions and timestamps.
 *
 * @param directoryPath - Path to directory where files will be extracted
 * @param options - Optional extraction configuration
 * @returns Node.js [`Writable`](https://nodejs.org/api/stream.html#class-streamwritable) stream to pipe tar archive bytes into
 *
 * @example
 * ```typescript
 * import { unpackTar } from 'modern-tar/fs';
 * import { createReadStream } from 'node:fs';
 * import { pipeline } from 'node:stream/promises';
 *
 * // Basic extraction
 * const tarStream = createReadStream('project.tar');
 * const extractStream = unpackTar('/output/directory');
 * await pipeline(tarStream, extractStream);
 *
 * // Extract with path manipulation and filtering
 * const advancedStream = unpackTar('/output', {
 *   strip: 1,  // Remove first path component
 *   filter: (header) => header.type === 'file' && header.name.endsWith('.js'),
 *   map: (header) => ({ ...header, mode: 0o644 })
 * });
 * await pipeline(createReadStream('archive.tar'), advancedStream);
 * ```
 */
export function unpackTar(
	directoryPath: string,
	options: UnpackOptionsFS = {},
): Writable {
	const { streamTimeout = 5000, ...fsOptions } = options;
	let timeoutId: NodeJS.Timeout | null = null;

	const { handler, signal } = createFSHandler(directoryPath, fsOptions);
	const unpacker = createTarUnpacker(handler, fsOptions);

	let stream: Writable;

	function resetTimeout() {
		if (timeoutId) clearTimeout(timeoutId);
		if (streamTimeout !== Infinity && streamTimeout > 0) {
			timeoutId = setTimeout(() => {
				const err = new Error(
					`Stream timed out after ${streamTimeout}ms of inactivity.`,
				);
				stream.destroy(err);
			}, streamTimeout);
		}
	}

	stream = new Writable({
		write(chunk, _, callback) {
			resetTimeout(); // Reset timer on every chunk
			if (signal.aborted) return callback(signal.reason as Error);
			try {
				unpacker.write(chunk);
				callback();
			} catch (writeErr) {
				callback(writeErr as Error);
			}
		},

		async final(callback) {
			if (timeoutId) clearTimeout(timeoutId); // Clean up timer on success
			try {
				if (signal.aborted) return callback(signal.reason as Error);
				unpacker.end();
				await handler.process();
				callback();
			} catch (finalErr) {
				callback(finalErr as Error);
			}
		},
	});

	stream.on("close", () => {
		if (timeoutId) clearTimeout(timeoutId);
	});

	resetTimeout(); // Start the initial timer.

	return stream;
}

function createFSHandler(directoryPath: string, options: UnpackOptionsFS) {
	const {
		maxDepth = 1024,
		dmode,
		fmode,
		concurrency = cpus().length || 8,
	} = options;

	const abortController = new AbortController();
	const { signal } = abortController;

	// Queue for managing concurrency.
	const opQueue: (() => void)[] = [];
	let activeOps = 0;

	// Build a dependency graph of promise paths to ensure tars on the same path are processed
	// sequentially while still allowing concurrency for different paths.
	const pathPromises = new Map<string, Promise<TarHeader["type"]>>();
	let activeEntryStream: PassThrough | null = null;

	let processingEnded = false;
	let resolveDrain: () => void;
	const drainPromise = new Promise<void>((resolve) => {
		resolveDrain = resolve;
	});

	const processQueue = () => {
		// Clear the queue if aborted.
		if (signal.aborted) opQueue.length = 0;

		// Start new operations while under the concurrency limit.
		while (activeOps < concurrency && opQueue.length > 0) {
			activeOps++;
			const op = opQueue.shift();
			if (!op) break;
			op();
		}

		if (processingEnded && activeOps === 0 && opQueue.length === 0) {
			resolveDrain();
		}
	};

	// Create the destination directory promise first.
	const destDirPromise = (async () => {
		const symbolic = normalizeUnicode(path.resolve(directoryPath));
		await fs.mkdir(symbolic, { recursive: true });
		try {
			const real = await fs.realpath(symbolic);
			return { symbolic, real };
		} catch (err) {
			if (signal.aborted) throw signal.reason;
			throw err;
		}
	})();
	destDirPromise.catch((err) => {
		if (!signal.aborted) abortController.abort(err);
	});

	// Recursively ensure all parent directories exist.
	const ensureDirectoryExists = (
		dirPath: string,
	): Promise<TarHeader["type"]> => {
		// Check cache first.
		let promise = pathPromises.get(dirPath);
		if (promise) return promise;

		// If the directory is the destination directory, it already exists.
		promise = (async (): Promise<TarHeader["type"]> => {
			if (signal.aborted) throw signal.reason;

			const destDir = await destDirPromise;
			if (dirPath === destDir.symbolic) return "directory";

			// Ensure parent directory exists first.
			await ensureDirectoryExists(path.dirname(dirPath));

			if (signal.aborted) throw signal.reason;

			// Check if the directory exists.
			try {
				await fs.mkdir(dirPath, { mode: dmode });
				return "directory";
			} catch (err: unknown) {
				if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

				const stat = await fs.lstat(dirPath);
				if (stat.isDirectory()) return "directory";

				// If it's a symlink, ensure it points to a directory within bounds.
				if (stat.isSymbolicLink()) {
					const realPath = await fs.realpath(dirPath);
					validateBounds(
						realPath,
						destDir.real,
						`Symlink "${dirPath}" points outside the extraction directory.`,
					);
					const realStat = await fs.stat(realPath);
					if (realStat.isDirectory()) return "directory";
				}
				throw new Error(`"${dirPath}" is not a valid directory component.`);
			}
		})();

		pathPromises.set(dirPath, promise);
		return promise;
	};

	const handler = {
		onHeader(header: TarHeader) {
			if (signal.aborted) return;

			activeEntryStream = new PassThrough({
				// Use 512KB buffer for files > 1MB.
				highWaterMark: header.size > 1048576 ? 524288 : undefined,
			});
			const entryStream = activeEntryStream;

			// Queue the operation.
			const startOperation = () => {
				let opPromise: Promise<TarHeader["type"]>;
				try {
					const transformed = transformHeader(header, options);
					if (!transformed) {
						entryStream.resume();
						activeOps--;
						processQueue();
						return;
					}

					// Normalize and resolve the target path.
					const name = normalizeHeaderName(transformed.name);
					const target = path.join(path.resolve(directoryPath), name);

					// Chain onto any prior operation for this path.
					const priorOpPromise =
						pathPromises.get(target) || Promise.resolve(undefined);

					// Start the operation promise chain.
					opPromise = priorOpPromise.then(async (priorOp) => {
						if (signal.aborted) throw signal.reason;
						if (priorOp) {
							const isConflict =
								(priorOp === "directory" && transformed.type !== "directory") ||
								(priorOp !== "directory" && transformed.type === "directory");

							if (isConflict)
								throw new Error(
									`Path conflict ${transformed.type} over existing ${priorOp} at "${transformed.name}"`,
								);
						}

						try {
							const destDir = await destDirPromise;

							// Prevent ReDOS via deep paths.
							if (maxDepth !== Infinity && name.split("/").length > maxDepth)
								throw new Error("Tar exceeds max specified depth.");

							const outPath = path.join(destDir.symbolic, name);
							validateBounds(
								outPath,
								destDir.symbolic,
								`Entry "${transformed.name}" points outside the extraction directory.`,
							);

							// Ensure parent directory exists.
							const parentDir = path.dirname(outPath);
							await ensureDirectoryExists(parentDir);

							switch (transformed.type) {
								case "directory":
									await fs.mkdir(outPath, {
										recursive: true,
										mode: dmode ?? transformed.mode,
									});
									break;

								case "file": {
									const fileStream = createWriteStream(outPath, {
										mode: fmode ?? transformed.mode,
										// Use 512KB buffer for files > 1MB.
										highWaterMark:
											transformed.size > 1048576 ? 524288 : undefined,
									});
									await pipeline(entryStream, fileStream);
									break;
								}

								case "symlink": {
									const { linkname } = transformed;
									if (!linkname) return transformed.type;
									const target = path.resolve(parentDir, linkname);
									validateBounds(
										target,
										destDir.symbolic,
										`Symlink "${linkname}" points outside the extraction directory.`,
									);
									await fs.symlink(linkname, outPath);
									break;
								}

								case "link": {
									const { linkname } = transformed;
									if (!linkname) return transformed.type;

									// Resolve the hardlink target path and ensure it's within destDir.
									const normalizedLink = normalizeUnicode(linkname);
									if (path.isAbsolute(normalizedLink)) {
										throw new Error(
											`Hardlink "${linkname}" points outside the extraction directory.`,
										);
									}

									// This is the symbolic path to the link's target inside the extraction dir.
									const linkTarget = path.join(
										destDir.symbolic,
										normalizedLink,
									);
									validateBounds(
										linkTarget,
										destDir.symbolic,
										`Hardlink "${linkname}" points outside the extraction directory.`,
									);
									await ensureDirectoryExists(path.dirname(linkTarget));

									// Resolve the real path of the parent directory which follows symlinks.
									const realTargetParent = await fs.realpath(
										path.dirname(linkTarget),
									);
									const realLinkTarget = path.join(
										realTargetParent,
										path.basename(linkTarget),
									);

									// Check that the real path is within the destination directory.
									validateBounds(
										realLinkTarget,
										destDir.real,
										`Hardlink "${linkname}" points outside the extraction directory.`,
									);

									// A self-referential hardlink should be a noop.
									if (linkTarget === outPath) return transformed.type;

									// Wait for the target to be created if it is in the map.
									const targetPromise = pathPromises.get(linkTarget);
									if (targetPromise) await targetPromise;

									await fs.link(linkTarget, outPath);
									break;
								}

								default:
									return transformed.type; // Unsupported type
							}

							// Set modification time if available.
							if (transformed.mtime) {
								const utimes =
									transformed.type === "symlink" ? fs.lutimes : fs.utimes;
								await utimes(
									outPath,
									transformed.mtime,
									transformed.mtime,
								).catch(() => {});
							}

							return transformed.type;
						} finally {
							// Ensure the entry stream is drained to avoid blocking.
							if (!entryStream.readableEnded) entryStream.resume();
						}
					});

					pathPromises.set(target, opPromise);
				} catch (err) {
					opPromise = Promise.reject(err);
					abortController.abort(err as Error);
				}

				opPromise
					.catch((err) => abortController.abort(err))
					.finally(() => {
						activeOps--;
						processQueue();
					});
			};

			opQueue.push(startOperation);
			processQueue();
		},

		onData(chunk: Uint8Array) {
			if (!signal.aborted) activeEntryStream?.write(chunk);
		},

		onEndEntry() {
			activeEntryStream?.end();
			activeEntryStream = null;
		},

		onError(error: Error) {
			abortController.abort(error);
		},

		async process() {
			processingEnded = true;
			processQueue();
			await drainPromise;
			if (signal.aborted) throw signal.reason;
		},
	};

	return { handler, signal };
}
