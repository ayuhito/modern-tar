import { transformHeader } from "../tar/options";
import type { TarHeader, UnpackOptions } from "../tar/types";
import { isBodyless, normalizeBody, streamToBuffer } from "../tar/utils";
import { createTarPacker } from "./pack";
import type { ParsedTarEntryWithData, TarEntry } from "./types";
import { createTarDecoder } from "./unpack";

/**
 * Packs an array of tar entries into a single `Uint8Array` buffer.
 *
 * For streaming scenarios or large archives, use {@link createTarPacker} instead.
 *
 * @param entries - Array of tar entries with headers and optional bodies
 * @returns A `Promise` that resolves to the complete tar archive as a Uint8Array
 * @example
 * ```typescript
 * import { packTar } from 'modern-tar';
 *
 * const entries = [
 *   {
 *     header: { name: "hello.txt", size: 5, type: "file" },
 *     body: "hello"
 *   },
 *   {
 *     header: { name: "data.json", size: 13, type: "file" },
 *     body: new Uint8Array([123, 34, 116, 101, 115, 116, 34, 58, 116, 114, 117, 101, 125]) // {"test":true}
 *   },
 *   {
 *     header: { name: "folder/", type: "directory", size: 0 }
 *   }
 * ];
 *
 * const tarBuffer = await packTar(entries);
 *
 * // Save to file or upload
 * await fetch('/api/upload', {
 *   method: 'POST',
 *   body: tarBuffer,
 *   headers: { 'Content-Type': 'application/x-tar' }
 * });
 * ```
 */
export async function packTar(entries: TarEntry[]): Promise<Uint8Array> {
	const { readable, controller } = createTarPacker();

	// This promise runs the packing process in the background.
	const packingPromise = (async () => {
		for (const entry of entries) {
			const entryStream = controller.add(entry.header);
			const { body } = entry;

			if (!body) {
				await entryStream.close();
				continue;
			}

			// Handle each body type.
			if (body instanceof ReadableStream) {
				await body.pipeTo(entryStream);
			} else if (body instanceof Blob) {
				await body.stream().pipeTo(entryStream);
			} else {
				// For all other types, normalize to a Uint8Array first.
				try {
					const chunk = await normalizeBody(body);
					if (chunk.length > 0) {
						const writer = entryStream.getWriter();
						await writer.write(chunk);
						await writer.close();
					} else {
						await entryStream.close();
					}
				} catch {
					throw new TypeError(
						`Unsupported content type for entry "${entry.header.name}".`,
					);
				}
			}
		}
	})()
		.then(() => controller.finalize())
		.catch((err) => controller.error(err));

	// Await the packing promise to ensure any background errors are thrown.
	await packingPromise;

	return new Uint8Array(await streamToBuffer(readable));
}

/**
 * Extracts all entries and their data from a complete tar archive buffer.
 *
 * For streaming scenarios or large archives, use {@link createTarDecoder} instead.
 *
 * @param archive - The complete tar archive as `ArrayBuffer` or `Uint8Array`
 * @param options - Optional extraction configuration
 * @returns A `Promise` that resolves to an array of entries with buffered data
 * @example
 * ```typescript
 * import { unpackTar } from 'modern-tar';
 *
 * // From a file upload or fetch
 * const response = await fetch('/api/archive.tar');
 * const tarBuffer = await response.arrayBuffer();
 *
 * const entries = await unpackTar(tarBuffer);
 * for (const entry of entries) {
 *   if (entry.data) {
 *     console.log(`File: ${entry.header.name}, Size: ${entry.data.length} bytes`);
 *     const content = new TextDecoder().decode(entry.data);
 *     console.log(`Content: ${content}`);
 *   } else {
 *     console.log(`${entry.header.type}: ${entry.header.name}`);
 *   }
 * }
 * ```
 * @example
 * ```typescript
 * // From a Uint8Array with options
 * const tarData = new Uint8Array([...]); // your tar data
 * const entries = await unpackTar(tarData, {
 *   strip: 1,
 *   filter: (header) => header.name.endsWith('.txt'),
 *   map: (header) => ({ ...header, name: header.name.toLowerCase() })
 * });
 *
 * // Process filtered files
 * for (const file of entries) {
 *   if (file.data) {
 *     console.log(new TextDecoder().decode(file.data));
 *   }
 * }
 * ```
 */
export async function unpackTar(
	archive: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
	options: UnpackOptions = {},
): Promise<ParsedTarEntryWithData[]> {
	const { streamTimeout = 5000, ...restOptions } = options;

	const sourceStream: ReadableStream<Uint8Array> =
		archive instanceof ReadableStream
			? archive
			: new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(
							archive instanceof Uint8Array ? archive : new Uint8Array(archive),
						);
						controller.close();
					},
				});

	const results: ParsedTarEntryWithData[] = [];

	const processingPromise = (async () => {
		const entryStream = sourceStream.pipeThrough(createTarDecoder(restOptions));
		const reader = entryStream.getReader();

		// Keep track of the last entry body stream to handle pipeline errors.
		let lastBodyStream: ReadableStream<Uint8Array> | null = null;

		try {
			while (true) {
				const { done, value: entry } = await reader.read();
				if (done) break;

				lastBodyStream = entry.body;

				// Apply unpack options directly in the read loop.
				let processedHeader: TarHeader | null;
				try {
					processedHeader = transformHeader(entry.header, restOptions);
				} catch (error) {
					// If filter/map functions throw, cancel the body stream.
					await entry.body.cancel();
					throw error;
				}

				// Entry is filtered out or stripped.
				if (processedHeader === null) {
					await entry.body.cancel();
					continue;
				}

				const bodyless = isBodyless(processedHeader);

				// For bodyless entries, don't buffer data and return undefined.
				if (bodyless) {
					await entry.body.cancel();
					results.push({
						header: processedHeader,
						data: undefined,
					});
				} else {
					// Fully buffer the entry body for files.
					results.push({
						header: processedHeader,
						data: await streamToBuffer(entry.body),
					});
				}

				lastBodyStream = null;
			}
		} catch (error) {
			// If the pipeline errors (e.g., decompression failure), the tar decoder flush might
			// not get called. Cancel the last known body stream to prevent hanging.
			if (lastBodyStream) {
				try {
					await lastBodyStream.cancel();
				} catch {}
			}
			throw error;
		} finally {
			try {
				reader.releaseLock();
			} catch {}
		}
		return results;
	})();

	// Race against timeout if specified to prevent hanging.
	if (streamTimeout !== Infinity) {
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => {
				reject(
					new Error(`Stream timed out after ${streamTimeout}ms of inactivity.`),
				);
			}, streamTimeout);
		});

		return Promise.race([processingPromise, timeoutPromise]);
	}

	return processingPromise;
}
