import { createTarOptionsTransformer } from "./options";
import { createTarPacker } from "./pack";
import type { ParsedTarEntryWithData, TarEntry, UnpackOptions } from "./types";
import { createTarDecoder } from "./unpack";
import { encoder, streamToBuffer } from "./utils";

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
				let chunk: Uint8Array;

				if (body === null || body === undefined) {
					chunk = new Uint8Array(0);
				} else if (body instanceof Uint8Array) {
					chunk = body;
				} else if (body instanceof ArrayBuffer) {
					chunk = new Uint8Array(body);
				} else if (typeof body === "string") {
					chunk = encoder.encode(body);
				} else {
					throw new TypeError(
						`Unsupported content type for entry "${entry.header.name}".`,
					);
				}

				const writer = entryStream.getWriter();
				await writer.write(chunk);
				await writer.close();
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
 * import { unpackTar } from '@modern-tar';
 *
 * // From a file upload or fetch
 * const response = await fetch('/api/archive.tar');
 * const tarBuffer = await response.arrayBuffer();
 *
 * const entries = await unpackTar(tarBuffer);
 * for (const entry of entries) {
 *   console.log(`File: ${entry.header.name}, Size: ${entry.data.length} bytes`);
 *
 *   if (entry.header.type === 'file') {
 *     const content = new TextDecoder().decode(entry.data);
 *     console.log(`Content: ${content}`);
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
 *   console.log(new TextDecoder().decode(file.data));
 * }
 * ```
 */
export async function unpackTar(
	archive: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
	options: UnpackOptions = {},
): Promise<ParsedTarEntryWithData[]> {
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

	const entryStream = sourceStream
		.pipeThrough(createTarDecoder(options))
		.pipeThrough(createTarOptionsTransformer(options));

	const reader = entryStream.getReader();
	try {
		while (true) {
			const { done, value: entry } = await reader.read();
			if (done) break;

			results.push({
				header: entry.header,
				data: await streamToBuffer(entry.body),
			});
		}
	} finally {
		reader.releaseLock();
	}

	return results;
}
