import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { UnpackOptions } from "../web/index";
import { createTarDecoder, createTarOptionsTransformer } from "../web/index";

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
	// Convert the reading end of the bridge to a Web ReadableStream.
	const bridge = new PassThrough();
	const webReadable = Readable.toWeb(bridge);

	const processingPromise = (async () => {
		const { validateSymlinks = true } = options;
		const resolvedDestDir = path.resolve(directoryPath);
		const createdDirs = new Set<string>();

		// Ensure destination directory exists upfront
		await fs.mkdir(resolvedDestDir, { recursive: true });
		createdDirs.add(resolvedDestDir);

		const entryStream = webReadable
			.pipeThrough(createTarDecoder())
			.pipeThrough(createTarOptionsTransformer(options));

		for await (const entry of entryStream) {
			const header = entry.header;
			const outPath = path.join(directoryPath, header.name);
			const parentDir = path.dirname(outPath);

			// Only create a directory if it hasn't been seen before
			if (!createdDirs.has(parentDir)) {
				await fs.mkdir(parentDir, { recursive: true });
				createdDirs.add(parentDir);
			}

			switch (header.type) {
				case "directory": {
					const mode = options.dmode ?? header.mode;
					// Check if the directory was already created as a parent of another entry
					if (createdDirs.has(outPath) && mode) {
						// If so, just ensure the permissions are correct
						await fs.chmod(outPath, mode);
					} else {
						// Otherwise, create it with the correct permissions
						await fs.mkdir(outPath, { recursive: true, mode });
						createdDirs.add(outPath);
					}
					break;
				}

				case "file": {
					await pipeline(
						Readable.fromWeb(entry.body),
						createWriteStream(outPath, { mode: options.fmode ?? header.mode }),
					);

					break;
				}

				case "symlink":
					if (header.linkname) {
						// Prevent path traversal attacks via symlinks.
						if (validateSymlinks) {
							const symlinkDir = path.dirname(outPath);
							const resolvedTarget = path.resolve(symlinkDir, header.linkname);

							if (
								!resolvedTarget.startsWith(resolvedDestDir + path.sep) &&
								resolvedTarget !== resolvedDestDir
							) {
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
						await fs.link(path.join(directoryPath, header.linkname), outPath);
					}

					break;
			}

			// Apply timestamps if available
			if (header.mtime) {
				try {
					const utimesFn = header.type === "symlink" ? fs.lutimes : fs.utimes;
					await utimesFn(outPath, header.mtime, header.mtime);
				} catch {
					// Ignore timestamp errors
				}
			}
		}
	})();

	const writable = new Writable({
		write(chunk, encoding, callback) {
			// This respects backpressure from the file system and parser.
			if (!bridge.write(chunk, encoding)) {
				bridge.once("drain", callback);
				return;
			}

			callback();
		},

		final(callback) {
			bridge.end();
			// Attach the final callback to the processing promise to ensure
			// all files are written before the stream finishes.
			processingPromise.then(() => callback()).catch(callback);
		},

		destroy(err, callback) {
			bridge.destroy(err as Error | undefined);
			callback(err);
		},
	});

	return writable;
}
