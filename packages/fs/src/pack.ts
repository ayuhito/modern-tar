import { createReadStream, type Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import type { TarHeader } from "@modern-tar/core";
import { BLOCK_SIZE, createTarHeader } from "@modern-tar/core";

/**
 * Filesystem-specific configuration options for packing directories into tar archives.
 *
 * These options are specific to Node.js filesystem operations and use Node.js-specific
 * types like `Stats` for file system metadata.
 */
export interface PackOptionsFS {
	/** Follow symlinks instead of storing them as symlinks (default: false) */
	dereference?: boolean;
	/** Filter function to include/exclude files (return false to exclude) */
	filter?: (path: string, stat: Stats) => boolean;
	/** Transform function to modify tar headers before packing */
	map?: (header: TarHeader) => TarHeader;
}

/**
 * Pack a directory into a Node.js [`Readable`](https://nodejs.org/api/stream.html#class-streamreadable) stream containing tar archive bytes.
 *
 * Recursively walks the directory structure and creates tar entries for files, directories,
 * symlinks, and hardlinks.
 *
 * @param directoryPath - Path to directory to pack
 * @param options - Optional packing configuration
 * @returns Node.js [`Readable`](https://nodejs.org/api/stream.html#class-streamreadable) stream of tar archive bytes
 *
 * @example
 * ```typescript
 * import { packTar } from '@modern-tar/fs';
 * import { createWriteStream } from 'node:fs';
 * import { pipeline } from 'node:stream/promises';
 *
 * // Basic directory packing
 * const tarStream = packTar('/home/user/project');
 * await pipeline(tarStream, createWriteStream('project.tar'));
 *
 * // With filtering and transformation
 * const filteredStream = packTar('/my/project', {
 *   filter: (path, stats) => !path.includes('node_modules'),
 *   map: (header) => ({ ...header, uname: 'builder' }),
 *   dereference: true  // Follow symlinks
 * });
 * ```
 */
export function packTar(
	directoryPath: string,
	options: PackOptionsFS = {},
): Readable {
	return Readable.from(
		(async function* () {
			const seenInodes = new Map<number, string>();
			// Start with the contents of the directory, not the directory itself.
			const queue: Array<[string, string]> = (
				await fs.readdir(directoryPath)
			).map((name) => [path.join(directoryPath, name), name]);

			while (queue.length > 0) {
				// biome-ignore lint/style/noNonNullAssertion: Length checked above.
				const [fullPath, relativePath] = queue.shift()!;
				const stat = await (options.dereference
					? fs.stat(fullPath)
					: fs.lstat(fullPath));

				if (options.filter?.(fullPath, stat) === false) {
					continue;
				}

				const header: TarHeader = {
					name: relativePath.replace(/\\/g, "/"),
					mode: stat.mode,
					mtime: stat.mtime,
					uid: stat.uid,
					gid: stat.gid,
					size: 0,
					type: "file",
				};

				// Handle hardlinks
				if (stat.isFile() && stat.nlink > 1) {
					const linkTarget = seenInodes.get(stat.ino);
					if (linkTarget) {
						header.type = "link";
						header.linkname = linkTarget;
					} else {
						seenInodes.set(stat.ino, header.name);
					}
				}

				// Handle directories and symlinks
				if (header.type !== "link") {
					if (stat.isDirectory()) {
						header.type = "directory";
						header.name = header.name.endsWith("/")
							? header.name
							: `${header.name}/`;

						const dirents = await fs.readdir(fullPath);

						for (const dirent of dirents) {
							queue.push([
								path.join(fullPath, dirent),
								path.join(relativePath, dirent),
							]);
						}
					} else if (stat.isSymbolicLink()) {
						header.type = "symlink";
						header.linkname = await fs.readlink(fullPath);
					} else if (stat.isFile()) {
						header.size = stat.size;
					}
				}

				const finalHeader = options.map ? options.map(header) : header;
				yield createTarHeader(finalHeader);

				// For files, stream the content followed by padding to the next block.
				if (finalHeader.type === "file" && finalHeader.size > 0) {
					yield* createReadStream(fullPath);
					const paddingSize =
						(BLOCK_SIZE - (finalHeader.size % BLOCK_SIZE)) % BLOCK_SIZE;
					if (paddingSize > 0) {
						yield new Uint8Array(paddingSize);
					}
				}
			}

			// End with two zero-filled blocks once all entries are processed, as per tar spec.
			yield new Uint8Array(BLOCK_SIZE * 2);
		})(),
	);
}
