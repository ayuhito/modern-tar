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
	let cancelError: Error | undefined;
	const pathCache = createPathCache(
		directoryPath,
		options,
		opQueue,
		concurrency,
	);

	// Track current file stream across write() calls for handling backpressure
	let currentFileStream: FileSink | null = null;
	// File closes overlap parsing, so cancellation must own detached sinks too.
	const fileStreams = new Set<FileSink>();
	let needsDrain = false;
	const writeCurrent = (chunk: Uint8Array) => {
		// biome-ignore lint/style/noNonNullAssertion: Called only while a file entry is active.
		const writeOk = currentFileStream!.write(chunk);
		if (!writeOk) needsDrain = true;
		return writeOk;
	};
	const onFileError = (err: Error) => {
		if (!writable.destroyed) writable.destroy(err);
	};
	const closeCurrent = () => {
		// biome-ignore lint/style/noNonNullAssertion: Called only while a file entry is active.
		const stream = currentFileStream!;
		currentFileStream = null;
		opQueue
			.add(() => stream.end())
			.then(
				() => fileStreams.delete(stream),
				(err) => {
					fileStreams.delete(stream);
					onFileError(err);
				},
			);
	};

	const writable = new Writable({
		async write(chunk, _, cb) {
			// File opens overlap within this write. Every exit reaches `finally`,
			// which waits for them to settle before calling `cb`.
			let pendingFileOpens: Promise<Error | undefined>[] | undefined;
			let writeError: Error | undefined;
			try {
				unpacker.write(chunk);

				if (unpacker.isEntryActive()) {
					// State was saved from previous write call, so continue processing.
					if (currentFileStream) {
						// Handle if body is not yet processed.
						while (!unpacker.isBodyComplete()) {
							needsDrain = false;
							const fed = unpacker.streamBody(writeCurrent);

							if (needsDrain) await currentFileStream.waitDrain();
							else if (fed === 0) return; // Need more data.
						}

						// Body complete, skip padding.
						if (!unpacker.skipPadding()) return;

						// Padding complete, close file.
						closeCurrent();
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
					if (cancelError) throw cancelError;

					// Only file entries return a path for streaming.
					if (outPath) {
						// Strip SUID/SGID/Sticky bits from header mode for security (limit to 0o777).
						const safeMode = transformedHeader.mode
							? transformedHeader.mode & 0o777
							: undefined;

						currentFileStream = createFileSink(
							outPath,
							{
								mode: options.fmode ?? safeMode,
								mtime: transformedHeader.mtime ?? undefined,
							},
							onFileError,
						);
						fileStreams.add(currentFileStream);
						(pendingFileOpens ??= []).push(
							currentFileStream.waitDrain().catch((error: Error) => error),
						);

						// Stream body from unpacker to file.
						while (!unpacker.isBodyComplete()) {
							needsDrain = false;
							const fed = unpacker.streamBody(writeCurrent);

							if (needsDrain) await currentFileStream.waitDrain();
							else if (fed === 0) return; // Need more data.
						}

						// Skip padding.
						if (!unpacker.skipPadding()) return; // Need more data.

						// Close without await.
						closeCurrent();
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
				const openError = pendingFileOpens
					? (await Promise.all(pendingFileOpens)).find((error) => error)
					: undefined;
				cb(cancelError ?? openError ?? writeError);
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
				if (cancelError) throw cancelError;
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
			const hasWork =
				fileStreams.size > 0 ||
				writable.writableLength > 0 ||
				(writable.writableEnded && !writable.writableFinished);
			if (!error && !hasWork) {
				callback(null);
				return;
			}
			cancelError = error ?? (AbortSignal.abort().reason as Error);
			for (const stream of fileStreams) stream.destroy(cancelError);
			fileStreams.clear();
			currentFileStream = null;
			callback(cancelError);
		},
	});

	return writable;
}
