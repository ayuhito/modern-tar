import { cpus } from "node:os";
import { Writable } from "node:stream";
import { transformHeader } from "../tar/options";
import { createUnpacker } from "../tar/unpacker";
import { createOperationQueue } from "./concurrency";
import type { FileSink } from "./file-sink";
import { createFileSink } from "./file-sink";
import { createPathCache } from "./path-cache";
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
	const unpacker = createUnpacker(options);
	const concurrency = options.concurrency || cpus().length || 8;
	const opQueue = createOperationQueue(concurrency);
	const pathCache = createPathCache(
		directoryPath,
		options,
		opQueue,
		concurrency,
	);

	// Track current file stream across write() calls for handling backpressure
	let currentFileStream: FileSink | null = null;
	let currentWriteCallback: ((chunk: Uint8Array) => boolean) | null = null;
	// Detached file closes must still fail extraction if they error later.
	let queuedError: Error | null = null;

	const onQueuedError = (err: Error) => {
		queuedError ??= err;
		if (!writable.destroyed) writable.destroy(err);
	};

	const writable = new Writable({
		async write(chunk, _, cb) {
			// File opens overlap within this write. Every exit reaches `finally`,
			// which waits for them to settle before calling `cb`.
			const pendingFileOpens: Promise<Error | undefined>[] = [];
			let writeError: Error | undefined;
			try {
				unpacker.write(chunk);

				if (unpacker.isEntryActive()) {
					// State was saved from previous write call, so continue processing.
					if (currentFileStream && currentWriteCallback) {
						let needsDrain = false;
						const writeCallback = currentWriteCallback;

						// Handle if body is not yet processed.
						while (!unpacker.isBodyComplete()) {
							needsDrain = false;
							const fed = unpacker.streamBody(writeCallback);

							if (fed === 0) {
								if (needsDrain) {
									await currentFileStream.waitDrain();
								} else {
									return; // Need more data.
								}
							}
						}

						// Body complete, skip padding.
						while (!unpacker.skipPadding()) {
							return;
						}

						// Padding complete, close file.
						const streamToClose = currentFileStream;
						if (streamToClose)
							opQueue.add(() => streamToClose.end()).catch(onQueuedError);

						currentFileStream = null;
						currentWriteCallback = null;
					} else {
						// Otherwise, just discard the entry body.
						if (!unpacker.skipEntry()) {
							return; // Need more data
						}
					}
				}

				// Process all available headers.
				while (true) {
					const header = unpacker.readHeader();

					// EOF shouldn't happen in write(), but handle it.
					if (header === undefined || header === null) {
						return;
					}

					// Transform header with options.
					const transformedHeader = transformHeader(header, options);
					// Filtered out.
					if (!transformedHeader) {
						if (!unpacker.skipEntry()) {
							return;
						}

						continue;
					}
					// Prepare filesystem path before writing body.
					const outPath = await opQueue.add(() =>
						pathCache.preparePath(transformedHeader),
					);

					// Only file entries return a path for streaming.
					if (outPath) {
						// Strip SUID/SGID/Sticky bits from header mode for security (limit to 0o777).
						const safeMode = transformedHeader.mode
							? transformedHeader.mode & 0o777
							: undefined;

						const fileStream = createFileSink(outPath, {
							mode: options.fmode ?? safeMode,
							mtime: transformedHeader.mtime ?? undefined,
						});
						pendingFileOpens.push(
							fileStream.waitDrain().catch((error: Error) => error),
						);

						// Stream body from unpacker to file.
						let needsDrain = false;
						const writeCallback = (chunk: Uint8Array): boolean => {
							const writeOk = fileStream.write(chunk);
							if (!writeOk) needsDrain = true;
							return writeOk;
						};

						while (!unpacker.isBodyComplete()) {
							needsDrain = false;
							const fed = unpacker.streamBody(writeCallback);

							if (fed === 0) {
								if (needsDrain) {
									await fileStream.waitDrain();
								} else {
									// Need more data, so save state to continue later.
									currentFileStream = fileStream;
									currentWriteCallback = writeCallback;
									return;
								}
							}
						}

						// Skip padding.
						while (!unpacker.skipPadding()) {
							// Need more data, so save state to continue later.
							currentFileStream = fileStream;
							currentWriteCallback = writeCallback;
							return;
						}

						// Close without await.
						opQueue.add(() => fileStream.end()).catch(onQueuedError);
					} else {
						// No body data or already handled.
						if (!unpacker.skipEntry()) {
							return;
						}
					}
				}
			} catch (err) {
				writeError = err as Error;
			} finally {
				const openError = pendingFileOpens.length
					? (await Promise.all(pendingFileOpens)).find((error) => error)
					: undefined;
				cb(openError ?? writeError);
			}
		},

		async final(cb) {
			try {
				// Close out remaining buffered data and flush the async operation queue.
				unpacker.end();
				unpacker.validateEOF();
				// Ensure all paths are prepared before cleanup.
				await pathCache.ready();
				// Wait for all file ops to complete.
				await opQueue.onIdle();
				if (queuedError) throw queuedError;
				// Validate symlink targets after all archive-created symlinks exist.
				await pathCache.checkSymlinks();
				// Now that all files are written, create the hardlinks.
				await pathCache.applyLinks();
				cb();
			} catch (err) {
				cb(err as Error);
			}
		},

		destroy(error, callback) {
			// Handle stream destruction asynchronously to prevent blocking
			(async () => {
				// Clean up any active file stream and reset state.
				if (currentFileStream) {
					currentFileStream.destroy(error ?? undefined);
					currentFileStream = null;
					currentWriteCallback = null;
				}

				// Drain active file operations.
				await opQueue.onIdle();
			})().then(
				() => callback(error ?? null),
				// If there is an error during cleanup, pass it to the callback instead.
				(e) =>
					callback(
						error ?? (e instanceof Error ? e : new Error("Stream destroyed")),
					),
			);
		},
	});

	return writable;
}
