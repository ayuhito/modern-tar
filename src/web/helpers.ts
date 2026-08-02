import { isBodyless, normalizeBody } from "../tar/body";
import { transformHeader } from "../tar/options";
import type { TarHeader, UnpackOptions } from "../tar/types";
import { createUnpacker } from "../tar/unpacker";
import { createTarPacker } from "./pack";
import { drain, streamToBuffer } from "./stream-utils";
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
export async function packTar(
	entries: readonly (TarEntry | ParsedTarEntryWithData)[],
): Promise<Uint8Array<ArrayBuffer>> {
	const { readable, controller } = createTarPacker();
	const archive = streamToBuffer(readable);

	try {
		for (const entry of entries) {
			const entryStream = controller.add(entry.header);

			// Handle both TarEntry and ParsedTarEntryWithData formats.
			const body =
				"body" in entry ? entry.body : (entry as ParsedTarEntryWithData).data;

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

		controller.finalize();
	} catch (error) {
		controller.error(error);
	}

	return archive;
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
	if (!(archive instanceof ReadableStream)) {
		return unpackTarBuffer(
			archive instanceof Uint8Array ? archive : new Uint8Array(archive),
			options,
		);
	}

	const results: ParsedTarEntryWithData[] = [];
	const entryStream = archive.pipeThrough(createTarDecoder(options));
	const reader = entryStream.getReader();

	try {
		while (true) {
			const { done, value: entry } = await reader.read();
			if (done) break;

			let processedHeader: TarHeader | null;
			try {
				processedHeader = transformHeader(entry.header, options);
			} catch (error) {
				// If filter/map functions throw, cancel the body stream and re-throw.
				await entry.body.cancel();
				throw error;
			}

			// Entry is filtered out or stripped, so we drain its body stream.
			if (processedHeader === null) {
				await drain(entry.body);
				continue;
			}

			// Check if this entry should have no body data
			const bodyless = isBodyless(processedHeader);

			// For bodyless entries (directories, symlinks, links), drain the body stream and use undefined.
			if (bodyless) {
				await drain(entry.body);
				results.push({ header: processedHeader });
			} else {
				// Fully buffer the entry body for files
				results.push({
					header: processedHeader,
					data: await streamToBuffer(entry.body),
				});
			}
		}
	} catch (error) {
		await reader.cancel(error).catch(() => {});
		throw error;
	} finally {
		reader.releaseLock();
	}

	return results;
}

function unpackTarBuffer(
	archive: Uint8Array,
	options: UnpackOptions,
): ParsedTarEntryWithData[] {
	const unpacker = createUnpacker(options);
	const strict = options.strict ?? false;
	const results: ParsedTarEntryWithData[] = [];

	unpacker.write(archive);
	unpacker.end();

	while (true) {
		const header = unpacker.readHeader();
		if (header === undefined) break;
		if (header === null) {
			if (strict) throw new Error("Tar archive is truncated.");
			break;
		}

		const processedHeader = transformHeader(header, options);
		if (processedHeader === null) {
			const skipped = unpacker.skipEntry();
			if (!skipped && strict) throw new Error("Tar archive is truncated.");
			if (!skipped) break;
			continue;
		}

		if (isBodyless(processedHeader)) {
			const skipped = unpacker.skipEntry();
			if (!skipped && strict) throw new Error("Tar archive is truncated.");

			results.push({ header: processedHeader });
			if (!skipped) break;
			continue;
		}

		let size = header.size;
		if (size < 0 || !unpacker.canFinish()) {
			if (strict) throw new Error("Tar archive is truncated.");
			size = unpacker.bodyBytes();
		}

		const data = new Uint8Array(size);
		let offset = 0;
		unpacker.streamBody((chunk) => {
			data.set(chunk, offset);
			offset += chunk.length;
			return true;
		});

		const bodyComplete = unpacker.isBodyComplete();
		let paddingComplete = true;
		if (bodyComplete) {
			paddingComplete = unpacker.skipPadding();
			if (!paddingComplete && strict) {
				throw new Error("Tar archive is truncated.");
			}
		}

		results.push({ header: processedHeader, data });
		if (!bodyComplete || !paddingComplete) break;
	}

	unpacker.validateEOF();
	return results;
}
