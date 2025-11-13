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
 * Helper to discard body data for filtered entries.
 * Returns true if complete, false if more data is needed.
 */
function discardBody(unpacker: ReturnType<typeof createUnpacker>): boolean {
	while (!unpacker.isBodyComplete()) {
		// Callback always returns true to discard data.
		unpacker.streamBody(() => true);
		if (!unpacker.isBodyComplete()) return false;
	}

	while (!unpacker.skipPadding()) return false;

	return true;
}

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
	const opQueue = createOperationQueue(
		options.concurrency || cpus().length || 8,
	);
	const pathCache = createPathCache(directoryPath, options);

	// Track current file stream across write() calls for handling backpressure
	let currentFileStream: FileSink | null = null;
	let currentWriteCallback: ((chunk: Uint8Array) => boolean) | null = null;
	let needsDiscardBody = false; // Track if we're in the middle of discarding

	return new Writable({
		async write(chunk, _, cb) {
			try {
				unpacker.write(chunk);

				// If we're in the middle of discarding a body, continue it
				if (needsDiscardBody) {
					if (!discardBody(unpacker)) {
						// Still need more data
						cb();
						return;
					}

					needsDiscardBody = false;
				}

				// If we're in the middle of streaming a file body, continue it
				if (currentFileStream && currentWriteCallback) {
					let needsDrain = false;
					const writeCallback = currentWriteCallback;

					while (!unpacker.isBodyComplete()) {
						needsDrain = false;
						const fed = unpacker.streamBody(writeCallback);

						if (fed === 0) {
							if (needsDrain) {
								await currentFileStream.waitDrain();
							} else {
								cb(); // Need more data.
								return;
							}
						}
					}

					// Body complete, skip padding.
					while (!unpacker.skipPadding()) {
						cb();
						return;
					}

					// Padding complete, close file.
					const streamToClose = currentFileStream;
					if (streamToClose) opQueue.add(() => streamToClose.end());

					currentFileStream = null;
					currentWriteCallback = null;
				}

				// Process all available headers.
				while (true) {
					const header = unpacker.readHeader();

					// EOF shouldn't happen in write(), but handle it.
					if (header === undefined) {
						cb();
						return;
					}

					// Need more data for header.
					if (header === null) {
						cb();
						return;
					}

					// Transform header with options.
					const transformedHeader = transformHeader(header, options);
					// Filtered out.
					if (!transformedHeader) {
						if (!discardBody(unpacker)) {
							needsDiscardBody = true;
							cb();
							return;
						}

						continue;
					}

					// Prepare filesystem path before writing body.
					const prep = await opQueue.add(() =>
						pathCache.preparePath(transformedHeader),
					);

					// Handle body based on entry type
					if (prep.type === "file") {
						const fileStream = createFileSink(prep.outPath, {
							mode: options.fmode ?? transformedHeader.mode ?? undefined,
							mtime: transformedHeader.mtime ?? undefined,
						});

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
									// Need more data, so save state for continuation.
									currentFileStream = fileStream;
									currentWriteCallback = writeCallback;
									cb();
									return;
								}
							}
						}

						// Skip padding.
						while (!unpacker.skipPadding()) {
							// Need more data, so save state for padding continuation.
							currentFileStream = fileStream;
							currentWriteCallback = writeCallback;
							cb();
							return;
						}

						// Close without await.
						opQueue.add(() => fileStream.end());
					} else {
						// No body data or already handled.
						if (!discardBody(unpacker)) {
							needsDiscardBody = true;
							cb();
							return;
						}
					}
				}
			} catch (err) {
				cb(err as Error);
			}
		},

		async final(cb) {
			try {
				// Close out remaining buffered data and flush the async operation queue.
				unpacker.end();
				unpacker.validateEOF();
				// Wait for all file ops to complete.
				await opQueue.onIdle();
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
}
