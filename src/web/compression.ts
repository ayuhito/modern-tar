/**
 * Creates a gzip compression stream using the native
 * [`CompressionStream`](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream) API.
 *
 * @returns A [`CompressionStream`](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream) configured for gzip compression
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
export function createGzipEncoder(): CompressionStream {
	return new CompressionStream("gzip");
}

/**
 * Creates a gzip decompression stream using the native
 * [`DecompressionStream`](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream) API.
 *
 * @returns A [`DecompressionStream`](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream) configured for gzip decompression
 * @example
 * ```typescript
 * import { createGzipDecoder, createTarDecoder } from 'modern-tar';
 *
 * // Download and process a .tar.gz file
 * const response = await fetch('https://api.example.com/archive.tar.gz');
 * if (!response.body) throw new Error('No response body');
 *
 * // Chain decompression and tar parsing
 * const entries = response.body
 *   .pipeThrough(createGzipDecoder())
 *   .pipeThrough(createTarDecoder());
 *
 * for await (const entry of entries) {
 *   console.log(`Extracted: ${entry.header.name}`);
 *   // Process entry.body ReadableStream as needed
 * }
 * ```
 * @example
 * ```typescript
 * // Decompress local .tar.gz data
 * const gzippedData = new Uint8Array([...]); // your gzipped tar data
 * const stream = new ReadableStream({
 *   start(controller) {
 *     controller.enqueue(gzippedData);
 *     controller.close();
 *   }
 * });
 *
 * const tarStream = stream.pipeThrough(createGzipDecoder());
 * // Now process tarStream with createTarDecoder()...
 * ```
 */
export function createGzipDecoder(): DecompressionStream {
	return new DecompressionStream("gzip");
}
