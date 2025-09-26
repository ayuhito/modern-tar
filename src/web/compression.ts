/**
 * Creates a gzip compression stream that is compatible with Uint8Array streams.
 *
 * @returns A {@link ReadableWritablePair} configured for gzip compression.
 * @example
 * ```typescript
 * import { createGzipEncoder, createTarPacker } from 'modern-tar';
 *
 * // Create and compress a tar archive
 * const { readable, controller } = createTarPacker();
 * const compressedStream = readable.pipeThrough(createGzipEncoder());
 *
 * // Add entries...
 * const fileStream = controller.add({ name: "file.txt", size: 5, type: "file" });
 * const writer = fileStream.getWriter();
 * await writer.write(new TextEncoder().encode("hello"));
 * await writer.close();
 * controller.finalize();
 *
 * // Upload compressed .tar.gz
 * await fetch('/api/upload', {
 *   method: 'POST',
 *   body: compressedStream,
 *   headers: { 'Content-Type': 'application/gzip' }
 * });
 * ```
 */
export function createGzipEncoder(): ReadableWritablePair<
	Uint8Array,
	Uint8Array
> {
	// CompressionStream uses generic `BufferSource` types which is a union type that includes `Uint8Array`,
	// while `pipeThrough` needs ONLY a `Uint8Array`. This causes type issues since TypeScript cannot guarantee
	// the code will always be used with `Uint8Array`, so we assert this.
	return new CompressionStream("gzip") as unknown as ReadableWritablePair<
		Uint8Array,
		Uint8Array
	>;
}

/**
 * Creates a gzip decompression stream that is compatible with Uint8Array streams.
 *
 * @returns A {@link ReadableWritablePair} configured for gzip decompression.
 * @example
 * ```typescript
 * import { createGzipDecoder, createTarDecoder } from 'modern-tar';
 *
 * // Download and process a .tar.gz file
 * const response = await fetch('https://api.example.com/archive.tar.gz');
 * if (!response.body) throw new Error('No response body');
 *
 * // Buffer entire archive
 * const entries = await unpackTar(response.body.pipeThrough(createGzipDecoder()));
 *
 * for (const entry of entries) {
 *   console.log(`Extracted: ${entry.header.name}`);
 *   const content = new TextDecoder().decode(entry.data);
 *   console.log(`Content: ${content}`);
 * }
 * ```
 * @example
 * ```typescript
 * import { createGzipDecoder, createTarDecoder } from 'modern-tar';
 *
 * // Download and process a .tar.gz file
 * const response = await fetch('https://api.example.com/archive.tar.gz');
 * if (!response.body) throw new Error('No response body');
 *
 * // Chain decompression and tar parsing using streams
 * const entries = response.body
 *   .pipeThrough(createGzipDecoder())
 *   .pipeThrough(createTarDecoder());
 *
 * for await (const entry of entries) {
 * console.log(`Extracted: ${entry.header.name}`);
 *   // Process entry.body ReadableStream as needed
 * }
 * ```
 */
export function createGzipDecoder(): ReadableWritablePair<
	Uint8Array,
	Uint8Array
> {
	// DecompressionStream uses generic `BufferSource` types which is a union type that includes `Uint8Array`,
	// while `pipeThrough` needs ONLY a `Uint8Array`. This causes type issues since TypeScript cannot guarantee
	// the code will always be used with `Uint8Array`, so we assert this.
	return new DecompressionStream("gzip") as unknown as ReadableWritablePair<
		Uint8Array,
		Uint8Array
	>;
}
