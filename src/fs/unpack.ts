import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createTarDecoder, createTarOptionsTransformer } from "../web/index";
import { streamToBuffer } from "../web/utils";
import { normalizeUnicode, validateBounds, validatePath } from "./path";
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
	// Create a stream pair for proper backpressure handling.
	const { readable, writable: webWritable } = new TransformStream<
		Uint8Array,
		Uint8Array
	>();

	const entryStream = readable
		.pipeThrough(createTarDecoder(options))
		.pipeThrough(createTarOptionsTransformer(options));

	const processingPromise = (async () => {
		const resolvedDestDir = normalizeUnicode(path.resolve(directoryPath));
		const validatedDirs = new Set<string>([resolvedDestDir]);

		// Ensure destination directory exists upfront
		await fs.mkdir(resolvedDestDir, { recursive: true });

		const reader = entryStream.getReader();
		try {
			// Prevent DoS attacks with deeply nested paths
			const maxDepth = options.maxDepth ?? 1024;

			while (true) {
				const { done, value: entry } = await reader.read();
				if (done) break;

				const { header } = entry;
				const normalizedName = normalizeUnicode(header.name);

				// Check path depth to prevent DoS attacks
				if (maxDepth !== Infinity) {
					const depth = normalizedName.split("/").length;

					if (depth > maxDepth) {
						throw new Error(
							`Path depth of entry "${header.name}" (${depth}) exceeds the maximum allowed depth of ${maxDepth}.`,
						);
					}
				}

				// Check for absolute paths in the entry name
				if (path.isAbsolute(normalizedName)) {
					throw new Error(
						`Path traversal attempt detected for entry "${header.name}".`,
					);
				}

				const outPath = path.join(resolvedDestDir, normalizedName);

				validateBounds(
					outPath,
					resolvedDestDir,
					`Path traversal attempt detected for entry "${header.name}".`,
				);

				const parentDir = path.dirname(outPath);

				await validatePath(parentDir, resolvedDestDir, validatedDirs);
				await fs.mkdir(parentDir, { recursive: true });

				switch (header.type) {
					case "directory": {
						const mode = options.dmode ?? header.mode;
						await fs.mkdir(outPath, {
							recursive: true,
							mode,
						});

						validatedDirs.add(outPath);
						break;
					}

					case "file": {
						// For < 32kb files, buffer the content and use writeFile to avoid overhead of creating a stream.
						if (header.size <= 32 * 1024) {
							await fs.writeFile(outPath, await streamToBuffer(entry.body), {
								mode: options.fmode ?? header.mode,
							});
						} else {
							await pipeline(
								Readable.fromWeb(entry.body),
								createWriteStream(outPath, {
									mode: options.fmode ?? header.mode,
								}),
							);
						}

						break;
					}

					case "symlink": {
						if (!header.linkname) break;

						if (options.validateSymlinks ?? true) {
							const symlinkDir = path.dirname(outPath);
							const resolvedTarget = path.resolve(symlinkDir, header.linkname);
							validateBounds(
								resolvedTarget,
								resolvedDestDir,
								`Symlink target "${header.linkname}" points outside the extraction directory.`,
							);
						}
						await fs.symlink(header.linkname, outPath);

						// This prevents cache poisoning attacks where a directory is replaced by a symlink.
						//
						// Invalidate the whole cache on Windows, because Windows normalizes paths aggressively.
						// Other platforms, we can just remove the specific directory from the cache.
						if (process.platform === "win32") {
							validatedDirs.clear();
							validatedDirs.add(resolvedDestDir);
						} else {
							validatedDirs.delete(outPath);
						}

						break;
					}

					case "link": {
						if (!header.linkname) break;

						const normalizedLinkname = normalizeUnicode(header.linkname);

						// Check for absolute paths in hardlink target
						if (path.isAbsolute(normalizedLinkname)) {
							throw new Error(
								`Hardlink target "${header.linkname}" points outside the extraction directory.`,
							);
						}

						const resolvedLinkTarget = path.resolve(
							resolvedDestDir,
							normalizedLinkname,
						);
						validateBounds(
							resolvedLinkTarget,
							resolvedDestDir,
							`Hardlink target "${header.linkname}" points outside the extraction directory.`,
						);

						await validatePath(
							path.dirname(resolvedLinkTarget),
							resolvedDestDir,
							validatedDirs,
						);

						await fs.link(resolvedLinkTarget, outPath);
						break;
					}

					default: {
						// Unsupported type, skip it. Handles "character-device", "block-device", "fifo", etc.
						await entry.body.cancel();
						break;
					}
				}

				// Apply timestamps if available
				if (header.mtime) {
					try {
						const utimesFn = header.type === "symlink" ? fs.lutimes : fs.utimes;
						await utimesFn(outPath, header.mtime, header.mtime);
					} catch {
						// Ignore timestamp errors
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	})();

	// Get the writer for the web writable stream
	const webWriter = webWritable.getWriter();
	let isWriterClosed = false;

	// Create the Node Writable stream with proper backpressure
	const writable = new Writable({
		async write(chunk, _encoding, callback) {
			if (isWriterClosed) return callback();

			try {
				// This await is important for backpressure. It will not resolve
				// until the web stream is ready for more data AND the processing
				// pipeline can handle it.
				await webWriter.write(chunk);
				callback();
			} catch (err) {
				callback(err as Error);
			}
		},

		async final(callback) {
			if (isWriterClosed) return callback();

			try {
				try {
					await webWriter.close();
					isWriterClosed = true;
				} catch {
					// If close fails, the stream might already be closed
					isWriterClosed = true;
				}

				// Wait for all processing to complete
				await processingPromise;
				callback();
			} catch (err) {
				callback(err as Error);
			}
		},

		destroy(err, callback) {
			if (isWriterClosed) return callback(err);
			isWriterClosed = true;

			// Abort the web writer and ensure the processing promise is also terminated.
			webWriter.abort(err).catch(() => {});
			entryStream.cancel(err).catch(() => {});

			// Wait for the promise to settle to ensure resources are released
			processingPromise.finally(() => {
				callback(err);
			});
		},
	});

	return writable;
}
