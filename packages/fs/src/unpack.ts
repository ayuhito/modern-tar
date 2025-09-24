import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Writable } from "node:stream";
import type { UnpackOptions } from "@modern-tar/core";
import {
	createTarDecoder,
	createTarOptionsTransformer,
} from "@modern-tar/core";

/**
 * Filesystem-specific configuration options for extracting tar archives to the filesystem.
 *
 * Extends the core {@link UnpackOptions} with Node.js filesystem-specific settings
 * for controlling file permissions and other filesystem behaviors.
 */
export interface UnpackOptionsFS extends UnpackOptions {
	/** Default mode for created directories (e.g., 0o755). If not specified, uses mode from tar header or system default */
	dmode?: number;
	/** Default mode for created files (e.g., 0o644). If not specified, uses mode from tar header or system default */
	fmode?: number;
	/**
	 * Prevent symlinks from pointing outside the extraction directory.
	 * @default true
	 */
	validateSymlinks?: boolean;
}

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
 * import { unpackTar } from '@modern-tar/fs';
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
	const chunks: Uint8Array[] = [];

	return new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(chunk);
			callback();
		},
		async final(callback) {
			try {
				const { validateSymlinks = true } = options;
				const resolvedDestDir = path.resolve(directoryPath);
				const blob = new Blob(chunks);
				const buffer = new Uint8Array(await blob.arrayBuffer());
				const tarStream = ReadableStream.from([buffer]);

				const entryStream = tarStream
					.pipeThrough(createTarDecoder())
					.pipeThrough(createTarOptionsTransformer(options));

				for await (const entry of entryStream) {
					const header = entry.header;
					const outPath = path.join(directoryPath, header.name);
					await fs.mkdir(path.dirname(outPath), { recursive: true });

					switch (header.type) {
						case "directory":
							await fs.mkdir(outPath, {
								recursive: true,
								mode: options.dmode ?? header.mode,
							});
							break;
						case "file": {
							const fileHandle = await fs.open(
								outPath,
								"w",
								options.fmode ?? header.mode,
							);
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
								if (validateSymlinks) {
									const symlinkDir = path.dirname(outPath);
									const resolvedTarget = path.resolve(
										symlinkDir,
										header.linkname,
									);

									if (
										!resolvedTarget.startsWith(resolvedDestDir + path.sep) &&
										resolvedTarget !== resolvedDestDir
									) {
										// To prevent path traversal attacks, throw an error if the target is outside.
										throw new Error(
											`Symlink target "${header.linkname}" points outside of the extraction directory.`,
										);
									}
								}
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
