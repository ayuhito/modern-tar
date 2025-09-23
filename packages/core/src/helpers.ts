import { createTarPacker } from "./pack";
import { createTarDecoder } from "./stream";
import type { ParsedTarEntryWithData, TarEntry } from "./types";
import { encoder } from "./utils";

/**
 * Packs an array of tar entries into a single Uint8Array buffer.
 *
 * @param entries - Array of tar entries with headers and optional bodies.
 * @returns A promise that resolves to the complete tar archive as a Uint8Array.
 * @example
 * ```typescript
 * import { packTar } from '@modern-tar/core';
 *
 * const entries = [
 *  {
 * 		header: { name: "hello.txt", size: 5, type: "file" },
 * 		body: "hello"
 * 	},
 * 	{
 * 		header: { name: "folder/", type: "directory" }
 * 	}
 * ];
 *
 * const tarBuffer = await packTar(entries);
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
				if (typeof body === "string") {
					chunk = encoder.encode(body);
				} else if (body instanceof Uint8Array) {
					chunk = body;
				} else {
					// Handles the ArrayBuffer case.
					chunk = new Uint8Array(body);
				}

				const writer = entryStream.getWriter();
				await writer.write(chunk);
				await writer.close();
			}
		}
	})()
		.then(() => controller.finalize())
		.catch((err) => controller.error(err));

	const response = new Response(readable);
	const buffer = await response.arrayBuffer();

	// Await the packing promise to ensure any background errors are thrown.
	await packingPromise;

	return new Uint8Array(buffer);
}

/**
 * Extracts all entries and their data from a tar archive buffer.
 *
 * @param archive - The complete tar archive (ArrayBuffer or Uint8Array).
 * @returns A promise that resolves to an array of entries with buffered data.
 * @example
 * ```typescript
 * import { unpackTar } from '@modern-tar/core';
 *
 * const tarBuffer = ...; // Some Uint8Array or ArrayBuffer containing a tar archive
 *
 * const entries = await unpackTar(tarBuffer);
 * for (const entry of entries) {
 * 		console.log(entry.header.name, entry.data);
 * }
 * ```
 */
export async function unpackTar(
	archive: ArrayBuffer | Uint8Array,
): Promise<ParsedTarEntryWithData[]> {
	// @ts-expect-error ReadableStream.from is supported.
	const sourceStream = ReadableStream.from([
		archive instanceof Uint8Array ? archive : new Uint8Array(archive),
	]);

	const results: ParsedTarEntryWithData[] = [];
	const decoderStream = sourceStream.pipeThrough(createTarDecoder());

	for await (const entry of decoderStream) {
		const data = new Uint8Array(await new Response(entry.body).arrayBuffer());
		results.push({ ...entry, data });
	}

	return results;
}
