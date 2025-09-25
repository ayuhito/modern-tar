import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createTarDecoder, createTarOptionsTransformer } from "../web/index";
import type { UnpackOptionsFS } from "./types";

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
	const bridge = new PassThrough();

	const readable = new ReadableStream({
		start(controller) {
			bridge.on("data", (chunk) => controller.enqueue(chunk));
			bridge.on("end", () => controller.close());
			bridge.on("error", (err) => controller.error(err));
		},

		cancel(reason) {
			bridge.destroy(
				reason instanceof Error ? reason : new Error(String(reason)),
			);
		},
	});

	const writable = new Writable({
		write(chunk, encoding, callback) {
			if (!bridge.write(chunk, encoding)) {
				bridge.once("drain", callback);
				return;
			}
			callback();
		},

		final(callback) {
			bridge.end();
			processingPromise.then(() => callback()).catch(callback);
		},

		destroy(err, callback) {
			bridge.destroy(err as Error | undefined);
			callback(err);
		},
	});

	const processingPromise = (async () => {
		const resolvedDestDir = path.resolve(directoryPath);
		const createdDirs = new Set<string>();

		// Ensure destination directory exists upfront
		await fs.mkdir(resolvedDestDir, { recursive: true });
		createdDirs.add(resolvedDestDir);

		const entryStream = readable
			.pipeThrough(createTarDecoder())
			.pipeThrough(createTarOptionsTransformer(options));

		const reader = entryStream.getReader();
		try {
			while (true) {
				const { done, value: entry } = await reader.read();
				if (done) break;

				const { header } = entry;

				// Check for absolute paths in the entry name
				if (path.isAbsolute(header.name)) {
					throw new Error(
						`Path traversal attempt detected for entry "${header.name}".`,
					);
				}

				const outPath = path.join(resolvedDestDir, header.name);

				if (!outPath.startsWith(resolvedDestDir)) {
					throw new Error(
						`Path traversal attempt detected for entry "${header.name}".`,
					);
				}

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
							createWriteStream(outPath, {
								mode: options.fmode ?? header.mode,
							}),
						);
						break;
					}

					case "symlink": {
						if (!header.linkname) break;

						if (options.validateSymlinks ?? true) {
							const symlinkDir = path.dirname(outPath);
							const resolvedTarget = path.resolve(symlinkDir, header.linkname);
							if (!resolvedTarget.startsWith(resolvedDestDir)) {
								throw new Error(
									`Symlink target "${header.linkname}" points outside the extraction directory.`,
								);
							}
						}
						await fs.symlink(header.linkname, outPath);
						break;
					}

					case "link": {
						if (!header.linkname) break;

						const resolvedLinkTarget = path.resolve(
							resolvedDestDir,
							header.linkname,
						);
						if (!resolvedLinkTarget.startsWith(resolvedDestDir)) {
							throw new Error(
								`Hardlink target "${header.linkname}" points outside the extraction directory.`,
							);
						}

						await fs.link(resolvedLinkTarget, outPath);

						break;
					}
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
		} finally {
			reader.releaseLock();
		}
	})();

	processingPromise.catch((err) => {
		writable.destroy(err);
	});

	return writable;
}
