/**
 * Creates a [`CompressionStream`](https://developer.mozilla.org/docs/Web/API/CompressionStream) for gzip compression.
 *
 * @returns Returns a standard Web Streams API [`CompressionStream`](https://developer.mozilla.org/docs/Web/API/CompressionStream) configured for gzip.
 * @example
 * ```typescript
 * import { createGzipEncoder, packTar } from '@modern-tar/core';
 *
 * // Compress a tar archive.
 * const entries = [{ header: { name: "file.txt", size: 5 }, body: "hello" }];
 * const tarStream = packTar(entries);
 * const compressedStream = tarStream.pipeThrough(createGzipEncoder());
 *
 * // Upload compressed tar to API.
 * await fetch('/api/upload', {
 * 		method: 'POST',
 * 		body: compressedStream,
 * 		headers: { 'Content-Type': 'application/gzip' }
 * });
 * ```
 */
export function createGzipEncoder(): CompressionStream {
	return new CompressionStream("gzip");
}

/**
 * Creates a [`DecompressionStream`](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream) for gzip decompression.
 *
 * @returns Returns a standard Web Streams API [`DecompressionStream`](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream) configured for gzip.
 * @example
 * ```typescript
 * import { createGzipDecoder, extractTar } from '@modern-tar/core';
 *
 * // Download and decompress .tar.gz from API
 * const response = await fetch('https://api.example.com/archive.tar.gz');
 * if (!response.body) throw new Error('No response body');
 *
 * const tarStream = response.body.pipeThrough(createGzipDecoder());
 *
 * for await (const entry of extractTar(tarStream)) {
 * 		console.log(`Extracted: ${entry.header.name}`);
 * }
 *
 * // Or decompress local .tar.gz data
 * const gzippedTarStream = new ReadableStream(...);
 * const decompressedStream = gzippedTarStream.pipeThrough(createGzipDecoder());
 * ```
 */
export function createGzipDecoder(): DecompressionStream {
	return new DecompressionStream("gzip");
}
