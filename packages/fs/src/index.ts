import * as core from "@modern-tar/core";

/**
 * All Web Streams APIs from [`@modern-tar/core`](https://www.npmjs.com/package/@modern-tar/core).
 *
 * Provides access to the full streaming tar API for advanced use cases or when you need
 * to work directly with Web Streams instead of Node.js streams.
 *
 * @example
 * ```typescript
 * import { web } from '@modern-tar/fs';
 *
 * // Use core streaming APIs
 * const { readable, controller } = web.createTarPacker();
 * const decoder = web.createTarDecoder();
 * const gzipStream = readable.pipeThrough(web.createGzipEncoder());
 * ```
 */
export const web = core;

export { type PackOptions, packTar } from "./pack";
export { type UnpackOptions, unpackTar } from "./unpack";
