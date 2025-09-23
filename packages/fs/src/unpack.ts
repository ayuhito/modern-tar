import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Writable } from "node:stream";
import type { TarHeader } from "@modern-tar/core";
import { createTarDecoder } from "@modern-tar/core";

/**
 * Options for extracting tar archives to the filesystem.
 */
export interface UnpackOptions {
	/** Number of leading path components to strip from entry names */
	strip?: number;
	/** Filter function to determine which entries to extract */
	filter?: (header: TarHeader) => boolean;
	/** Transform function to modify headers before extraction */
	map?: (header: TarHeader) => TarHeader;
}

/**
 * Extract a tar archive to a directory.
 *
 * Returns a Node.js Writable stream to pipe tar archive bytes into. Files, directories,
 * symlinks, and hard links are written to the filesystem with correct permissions
 * and timestamps.
 *
 * @param directoryPath - Path to directory where files will be extracted
 * @param options - Extraction options for filtering, mapping, and path manipulation
 * @returns Node.js Writable stream to pipe tar archive bytes into
 *
 * @example
 * ```typescript
 * import { packTar, unpackTar } from '@modern-tar/fs';
 * import { createReadStream } from 'node:fs';
 * import { pipeline } from 'node:stream/promises';
 *
 * // Basic streaming extraction
 * const tarStream = createReadStream('archive.tar');
 * const extractStream = unpackTar('/output/directory');
 * await pipeline(tarStream, extractStream);
 *
 * // Extract with path stripping
 * const tarStream2 = createReadStream('archive.tar');
 * const extractStream2 = unpackTar('/output/directory', {
 *   strip: 1  // Remove first path component
 * });
 * await pipeline(tarStream2, extractStream2);
 *
 * // Extract with filtering
 * const tarStream3 = createReadStream('archive.tar');
 * const extractStream3 = unpackTar('/output/directory', {
 *   filter: (header) => !header.name.includes('.tmp')
 * });
 * await pipeline(tarStream3, extractStream3);
 * ```
 */
export function unpackTar(
	directoryPath: string,
	options: UnpackOptions = {},
): Writable {
	const chunks: Uint8Array[] = [];

	return new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(chunk);
			callback();
		},
		async final(callback) {
			try {
				const blob = new Blob(chunks);
				const buffer = new Uint8Array(await blob.arrayBuffer());
				const tarStream = ReadableStream.from([buffer]);

				for await (const entry of tarStream.pipeThrough(createTarDecoder())) {
					const header = options.map ? options.map(entry.header) : entry.header;

					if (options.filter?.(header) === false) {
						for await (const _ of entry.body) {
						} // Drain and discard
						continue;
					}

					if (options.strip) {
						const strippedName = header.name
							.split("/")
							.slice(options.strip)
							.join("/");
						if (!strippedName) {
							for await (const _ of entry.body) {
							} // Drain and discard
							continue;
						}
						header.name = strippedName;
					}

					const outPath = path.join(directoryPath, header.name);
					await fs.mkdir(path.dirname(outPath), { recursive: true });

					switch (header.type) {
						case "directory":
							await fs.mkdir(outPath, { recursive: true, mode: header.mode });
							break;
						case "file": {
							const fileHandle = await fs.open(outPath, "w", header.mode);
							try {
								for await (const chunk of entry.body) {
									await fileHandle.write(chunk);
								}
							} finally {
								await fileHandle.close();
							}
							break;
						}
						case "symlink":
							if (header.linkname) {
								await fs.symlink(header.linkname, outPath);
							}
							break;
						case "link":
							if (header.linkname) {
								await fs.link(
									path.join(directoryPath, header.linkname),
									outPath,
								);
							}
							break;
					}

					// Apply timestamps.
					if (header.mtime) {
						try {
							const utimesFn =
								header.type === "symlink" ? fs.lutimes : fs.utimes;
							await utimesFn(outPath, header.mtime, header.mtime);
						} catch {}
					}
				}
				callback();
			} catch (err) {
				callback(err instanceof Error ? err : new Error(String(err)));
			}
		},
	});
}
