import * as fs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import * as fsp from "node:fs/promises";
import { cpus } from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { normalizeBody } from "../tar/body";
import { DIRECTORY, FILE, LINK, SYMLINK } from "../tar/constants";
import { createTarPacker } from "../tar/packer";
import type { TarHeader } from "../tar/types";
import { normalizeName } from "./path";
import type { PackOptionsFS, TarSource } from "./types";

type FileBody = { handle: FileHandle; size: number } | Uint8Array | Readable;

type JobResult = {
	header: TarHeader;
	body?: FileBody;
};

const BIGINT_STAT = { bigint: true } as const;
const WITH_FILE_TYPES = { withFileTypes: true } as const;

/**
 * @deprecated Use `packTar` instead. This function is now an alias for `packTar`.
 */
export const packTarSources = packTar;

/**
 * Pack a directory or multiple sources into a Node.js `Readable` stream containing
 * tar archive bytes. Can pack either a single directory or an array of sources
 * (files, directories, or raw content).
 *
 * @param sources - Either a directory path string or an array of {@link TarSource} objects.
 * @param options - Optional packing configuration using {@link PackOptionsFS}.
 * @returns Node.js [`Readable`](https://nodejs.org/api/stream.html#class-streamreadable) stream of tar archive bytes
 *
 * @example
 * ```typescript
 * import { packTar } from 'modern-tar/fs';
 * import { createWriteStream } from 'node:fs';
 * import { pipeline } from 'node:stream/promises';
 *
 * // Basic directory packing
 * const tarStream = packTar('/home/user/project');
 * await pipeline(tarStream, createWriteStream('project.tar'));
 *
 * // Pack multiple sources
 * const sources = [
 *   { type: 'file', source: './package.json', target: 'project/package.json' },
 *   { type: 'directory', source: './src', target: 'project/src' },
 *   { type: 'content', content: 'hello world', target: 'project/hello.txt' }
 * ];
 * const archiveStream = packTar(sources);
 * await pipeline(archiveStream, createWriteStream('project.tar'));
 *
 * // With filtering and transformation
 * const filteredStream = packTar('/my/project', {
 *   filter: (path, stats) => !path.includes('node_modules'),
 *   map: (header) => ({ ...header, uname: 'builder' }),
 *   dereference: true  // Follow symlinks
 * });
 * ```
 */
export function packTar(
	sources: readonly TarSource[] | string,
	options: PackOptionsFS = {},
): Readable {
	const results = new Map<number, JobResult | null>();
	// A null value is open; a Promise is already closing the handle.
	const fileHandles = new Map<FileHandle, Promise<void> | null>();
	const bodyStreams = new Set<Readable>();

	let resume: (() => void) | null = null;
	let drain: Promise<void> | null = null;
	// Notifies the writer when its next job result is ready.
	let resumeWriter: (() => void) | null = null;
	let cancelError: Error;

	const unblock = () => {
		const resolve = resume;
		resume = null;
		drain = null;
		resolve?.();
	};
	const wakeWriter = () => {
		resumeWriter?.();
		resumeWriter = null;
	};

	const destroyBody = (body: Readable, reason: Error) => {
		bodyStreams.delete(body);
		body.destroy(reason);
	};
	const closeHandle = (handle: FileHandle) => {
		const closing = fileHandles.get(handle);
		if (closing !== null) return closing;

		const promise = handle.close().finally(() => fileHandles.delete(handle));
		fileHandles.set(handle, promise);
		return promise;
	};

	const stop = async (reason: Error) => {
		for (const body of bodyStreams) destroyBody(body, reason);
		const closing = Promise.allSettled(
			[...fileHandles.keys()].map(closeHandle),
		);
		results.clear();
		wakeWriter();

		for (const result of await closing) {
			if (result.status === "rejected") throw result.reason;
		}
	};

	const stream = new Readable({
		highWaterMark: 8 * 1024 * 1024,
		read: unblock,
		destroy(error, callback) {
			cancelError = error ?? AbortSignal.abort().reason;
			unblock();
			void stop(cancelError).then(
				() => callback(error),
				(closeError) => callback(error ?? closeError),
			);
		},
	});
	const onError = (error: Error) => stream.destroy(error);

	const packer = createTarPacker((chunk) => {
		if (stream.destroyed) throw cancelError;
		if (!stream.push(Buffer.from(chunk)) && !drain) {
			drain = new Promise<void>((resolve) => {
				resume = resolve;
			});
		}
	});

	(async () => {
		// After every await or user callback, stop before acquiring resources,
		// invoking another callback, or publishing a result.
		const {
			dereference = false,
			filter,
			map,
			baseDir,
			concurrency = cpus().length || 8,
		} = options;

		// Determine input type and resolve directory path if needed
		let directoryPath: string | undefined;
		let realBaseDir: string | undefined;

		// Create initial job queue from directory contents or provided sources.
		let jobs: TarSource[];
		if (typeof sources === "string") {
			const source = path.resolve(sources);
			directoryPath = source;
			const before = await fsp.stat(source, BIGINT_STAT);
			if (stream.destroyed) return;
			const entries = await fsp.readdir(source, WITH_FILE_TYPES);
			if (stream.destroyed) return;
			const after = await fsp.stat(source, BIGINT_STAT);
			if (stream.destroyed) return;

			jobs =
				before.dev === after.dev && before.ino === after.ino
					? entries.map((entry) => ({
							type: entry.isDirectory() ? DIRECTORY : FILE,
							source: path.join(source, entry.name),
							target: entry.name,
						}))
					: [];
		} else {
			// Snapshot the sources array to avoid mutation during processing.
			jobs = sources.map((source) => ({ ...source }));
		}

		// inodes can be 64-bit, so use bigint for correctness.
		const seenInodes = new Map<bigint, string>();

		let jobIndex = 0;
		let writeIndex = 0;
		let activeWorkers = 0;
		let allJobsQueued = false;

		const writeStreamBody = async (body: Readable) => {
			try {
				for await (const chunk of body) {
					if (stream.destroyed) return;
					packer.write(
						chunk instanceof Uint8Array ? chunk : Buffer.from(chunk),
					);
					if (drain) await drain;
				}
			} finally {
				body.off("error", onError);
				bodyStreams.delete(body);
			}
		};

		const writer = async () => {
			// Pre-allocate read buffers, but only lazily allocate the large one if needed.
			const readBufferSmall = Buffer.alloc(64 * 1024); // 64KB
			let readBufferLarge: Buffer | null = null; // 1MB

			while (true) {
				if (stream.destroyed) return;

				// Terminate only when all jobs generated by workers have been written.
				if (allJobsQueued && writeIndex >= jobs.length) break;

				// Wait for the next result if it's not ready yet.
				if (!results.has(writeIndex)) {
					await new Promise<void>((resolve) => {
						resumeWriter = resolve;
					});
					continue;
				}

				// Write out all ready results in order. Clean up maps to free memory.
				// biome-ignore lint/style/noNonNullAssertion: .has check above.
				const result = results.get(writeIndex)!;
				results.delete(writeIndex);

				// Skip null results (filtered out).
				if (!result) {
					writeIndex++;
					controller();
					continue;
				}

				packer.add(result.header);
				if (drain) await drain;
				if (stream.destroyed) return;

				// Write file content if present.
				if (result.body) {
					if (result.body instanceof Uint8Array) {
						if (result.body.length > 0) {
							packer.write(result.body);
							if (drain) await drain;
						}
					} else if (result.body instanceof Readable) {
						await writeStreamBody(result.body);
					} else {
						const { handle, size } = result.body;
						// Select a 64KB or 1MB buffer based on file size > 1MB.
						const readBuffer =
							size > 1024 * 1024
								? (readBufferLarge ??= Buffer.alloc(1024 * 1024))
								: readBufferSmall;

						try {
							let bytesLeft = size;
							while (bytesLeft > 0 && !stream.destroyed) {
								const { bytesRead } = await handle.read(
									readBuffer,
									0,
									Math.min(bytesLeft, readBuffer.length),
									null,
								);
								if (bytesRead === 0) break; // EOF
								packer.write(readBuffer.subarray(0, bytesRead));
								bytesLeft -= bytesRead;
								if (drain) await drain;
							}
						} finally {
							await closeHandle(handle);
						}
					}
				}
				if (stream.destroyed) return;
				packer.endEntry();
				if (drain) await drain;
				writeIndex++;
				controller();
			}
		};

		const controller = () => {
			if (stream.destroyed || allJobsQueued) return;

			// Start new workers while under concurrency limit and jobs remain.
			while (
				activeWorkers < concurrency &&
				jobIndex < jobs.length &&
				jobIndex - writeIndex < concurrency
			) {
				activeWorkers++;
				const currentIndex = jobIndex++;

				processJob(jobs[currentIndex], currentIndex)
					.catch(onError)
					.finally(() => {
						activeWorkers--;
						controller(); // Check for more work.
					});
			}

			// If no active workers and all jobs have been queued, signal completion.
			if (activeWorkers === 0 && jobIndex >= jobs.length) {
				allJobsQueued = true;
				wakeWriter();
			}
		};

		const processJob = async (job: TarSource, index: number) => {
			let jobResult: JobResult | null = null;

			// Normalize target path to use forward slashes.
			const target = normalizeName(job.target);

			try {
				if (job.type === "content" || job.type === "stream") {
					let body: FileBody | undefined;
					let size: number;
					const isDir = target.endsWith("/");

					if (job.type === "stream") {
						if ((!isDir && job.size <= 0) || (isDir && job.size !== 0))
							throw new Error(
								isDir
									? "Streams for directories must have size 0."
									: "Streams require a positive size.",
							);

						size = job.size;
					} else {
						const content = await normalizeBody(job.content);
						size = content.length;
						body = content;
					}

					const stat = {
						size: isDir ? 0 : size,
						isFile: () => !isDir,
						isDirectory: () => isDir,
						isSymbolicLink: () => false,
						mode: job.mode,
						mtime: job.mtime ?? new Date(),
						uid: job.uid ?? 0,
						gid: job.gid ?? 0,
					} as fs.Stats;

					if (stream.destroyed) return;
					if (filter && !filter(target, stat)) return;
					if (stream.destroyed) return;

					let header: TarHeader = {
						name: target,
						type: isDir ? DIRECTORY : FILE,
						size: isDir ? 0 : size,
						mode: stat.mode,
						mtime: stat.mtime,
						uid: stat.uid,
						gid: stat.gid,
						uname: job.uname,
						gname: job.gname,
					};

					if (map) header = map(header);
					if (stream.destroyed) return;

					if (!isDir && job.type === "stream") {
						body =
							job.content instanceof Readable
								? job.content
								: Readable.fromWeb(job.content as NodeReadableStream);
						body.once("error", onError);
						bodyStreams.add(body);
					}

					jobResult = { header, body: isDir ? undefined : body };

					return;
				}

				let source = job.source;
				let stat = await fsp.lstat(source, BIGINT_STAT);
				if (stream.destroyed) return;

				// Optionally follow symlinks to their targets.
				if (dereference && stat.isSymbolicLink()) {
					source = await fsp.realpath(source);
					if (stream.destroyed) return;

					// `realpath` follows the whole symlink chain. Compare the final
					// target against a real base.
					realBaseDir ??= await fsp.realpath(
						baseDir ?? directoryPath ?? process.cwd(),
					);
					if (stream.destroyed) return;
					const relativeToBase = path.relative(realBaseDir, source);
					if (
						relativeToBase === ".." ||
						// biome-ignore lint/style/useTemplate: Smaller minified output.
						relativeToBase.startsWith(".." + path.sep) ||
						path.isAbsolute(relativeToBase)
					) {
						return; // Skip and do no further work.
					}

					stat = await fsp.lstat(source, BIGINT_STAT);
					// If the resolved target became a symlink again, avoid following a
					// second mutable path chain.
					if (stat.isSymbolicLink()) return;
				}

				if (stream.destroyed) return;
				if (filter && !filter(job.source, stat as unknown as fs.Stats)) return;
				if (stream.destroyed) return;

				// Cast bigint fields to number where safe.
				let header: TarHeader = {
					name: target,
					size: 0,
					mode: job.mode ?? Number(stat.mode),
					mtime:
						job.mtime === undefined
							? stat.mtime
							: new Date(job.mtime.getTime()),
					uid: job.uid ?? Number(stat.uid),
					gid: job.gid ?? Number(stat.gid),
					uname: job.uname,
					gname: job.gname,
					type: FILE, // Default type
				};

				let body: FileBody | undefined;
				if (stat.isDirectory()) {
					header.type = DIRECTORY;
					header.name = target.endsWith("/") ? target : `${target}/`;

					// Enqueue children for processing.
					try {
						const entries = await fsp.readdir(source, WITH_FILE_TYPES);
						if (stream.destroyed) return;
						const after = await fsp.lstat(source, BIGINT_STAT);

						if (
							stream.destroyed ||
							!after.isDirectory() ||
							stat.dev !== after.dev ||
							stat.ino !== after.ino
						)
							return;

						for (const d of entries) {
							jobs.push({
								type: d.isDirectory() ? DIRECTORY : FILE,
								source: path.join(source, d.name),
								target: `${header.name}${d.name}`, // Reuse normalized parent path.
								mtime: job.mtime,
								uid: job.uid,
								gid: job.gid,
								uname: job.uname,
								gname: job.gname,
								mode: job.mode,
							});
						}
					} catch {}
				} else if (stat.isSymbolicLink()) {
					// Store the link itself, not the target file.
					header.type = SYMLINK;
					header.linkname = await fsp.readlink(job.source);
				} else if (stat.isFile()) {
					header.size = Number(stat.size);
					let handleToClose: FileHandle | undefined;
					let linkname = stat.nlink > 1 ? seenInodes.get(stat.ino) : undefined;

					try {
						let after: fs.BigIntStats | undefined;
						try {
							if (header.size === 0 || linkname !== undefined) {
								// Header-only entries still need a second identity check, but do not
								// need an open descriptor because no file body will be read.
								after = await fsp.lstat(source, BIGINT_STAT);
							} else {
								// Reject final-component symlink swaps before opening a file body.
								handleToClose = await fsp.open(
									source,
									fs.constants.O_NOFOLLOW ?? 0,
								);
								fileHandles.set(handleToClose, null);
							}
						} catch (error) {
							const code = (error as { code?: string }).code;
							if (code === "ELOOP" || code === "ENOENT") return;
							throw error;
						}
						if (stream.destroyed) return;

						if (after) {
							if (
								!after.isFile() ||
								stat.dev !== after.dev ||
								stat.ino !== after.ino
							)
								return;
						} else {
							// biome-ignore lint/style/noNonNullAssertion: The open branch completed.
							const { dev, ino } = await handleToClose!.stat(BIGINT_STAT);
							if (stream.destroyed) return;
							// Read only if the opened fd still points at the inode validated by
							// lstat. This catches replacement between check and open.
							if (stat.dev !== dev || stat.ino !== ino) return;
						}

						// Deduplicate hard links with inode number.
						if (stat.nlink > 1) linkname = seenInodes.get(stat.ino);
						if (linkname !== undefined) {
							header.type = LINK;
							header.linkname = linkname;
							header.size = 0;
						} else {
							// Else handle as a regular file.
							if (stat.nlink > 1) seenInodes.set(stat.ino, target);
							if (header.size > 0) {
								// biome-ignore lint/style/noNonNullAssertion: A body requires an opened handle.
								const handle = handleToClose!;
								// If the file is small (< 32KB), read it into a buffer immediately.
								if (header.size < 32 * 1024) {
									const buffer = Buffer.allocUnsafe(header.size);
									let offset = 0;
									while (offset < buffer.length && !stream.destroyed) {
										const { bytesRead } = await handle.read(
											buffer,
											offset,
											buffer.length - offset,
											offset,
										);
										if (bytesRead === 0) break;
										offset += bytesRead;
									}
									body =
										offset === buffer.length
											? buffer
											: buffer.subarray(0, offset);
								} else {
									// The writer owns and closes this descriptor once it streams.
									body = { handle, size: header.size };
									handleToClose = undefined;
								}
							}
						}
					} finally {
						if (handleToClose) await closeHandle(handleToClose);
					}
				} else {
					return; // Skip unsupported file types (sockets, FIFOs, etc.)
				}

				if (stream.destroyed) return;
				if (map) header = map(header);
				jobResult = { header, body };
			} finally {
				if (stream.destroyed) {
					if (jobResult?.body instanceof Readable)
						destroyBody(jobResult.body, cancelError);
					else if (jobResult?.body && !(jobResult.body instanceof Uint8Array))
						await closeHandle(jobResult.body.handle);
				} else {
					// Store the result (or null if filtered out) and notify the writer.
					results.set(index, jobResult);
					if (index === writeIndex) wakeWriter();
				}
			}
		};

		// Start the controller and writer.
		controller();
		await writer();

		// Finalize the packer to write end-of-archive blocks.
		if (!stream.destroyed) {
			packer.finalize();
			stream.push(null);
		}
	})().catch(onError);

	return stream;
}
