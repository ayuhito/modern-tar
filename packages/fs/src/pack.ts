import { createReadStream, type Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import type { TarHeader } from "@modern-tar/core";
import { createTarPacker } from "@modern-tar/core";

/**
 * Configuration options for packing directories into tar archives.
 */
export interface PackOptions {
	/** Follow symlinks instead of storing them as symlinks (default: false) */
	dereference?: boolean;
	/** Filter function to include/exclude files (return false to exclude) */
	filter?: (path: string, stat: Stats) => boolean;
	/** Transform function to modify tar headers before packing */
	map?: (header: TarHeader) => TarHeader;
}

async function* walk(directoryPath: string, options: PackOptions) {
	const queue: Array<[string, string]> = [[directoryPath, "."]];
	const seenInodes = new Map<number, string>(); // For hardlink detection

	while (queue.length > 0) {
		// biome-ignore lint/style/noNonNullAssertion: Length checked above.
		const [fullPath, entryName] = queue.shift()!;
		const stat = await (options.dereference
			? fs.stat(fullPath)
			: fs.lstat(fullPath));

		if (options.filter?.(fullPath, stat) === false) continue;

		// Handle hardlinks: yield a 'link' type for subsequent sightings of an inode.
		if (stat.isFile() && stat.nlink > 1) {
			const linkTarget = seenInodes.get(stat.ino);
			if (linkTarget) {
				yield { fullPath, stat, entryName, linkname: linkTarget };
				continue;
			}
			seenInodes.set(stat.ino, entryName);
		}

		yield { fullPath, stat, entryName, linkname: undefined };

		if (stat.isDirectory()) {
			const dirents = await fs.readdir(fullPath);
			for (const dirent of dirents) {
				queue.push([path.join(fullPath, dirent), path.join(entryName, dirent)]);
			}
		}
	}
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
	options: PackOptions = {},
): Readable {
	const { readable, controller } = createTarPacker();

	(async () => {
		try {
			for await (const { fullPath, stat, entryName, linkname } of walk(
				directoryPath,
				options,
			)) {
				// Base header attributes
				const header: TarHeader = {
					name: entryName.replace(/\\/g, "/"), // Normalize slashes
					mode: stat.mode,
					mtime: stat.mtime,
					uid: stat.uid,
					gid: stat.gid,
					size: 0,
					type: "file", // Default type
				};

				// Determine entry type and set type-specific properties
				if (linkname) {
					header.type = "link";
					header.linkname = linkname;
				} else if (stat.isDirectory()) {
					header.type = "directory";
					header.name = header.name.endsWith("/")
						? header.name
						: `${header.name}/`;
				} else if (stat.isSymbolicLink()) {
					header.type = "symlink";
					header.linkname = await fs.readlink(fullPath);
				} else if (stat.isFile()) {
					header.size = stat.size;
				}

				// Apply user-defined transformations
				const finalHeader = options.map ? options.map(header) : header;
				const entryStream = controller.add(finalHeader);

				if (finalHeader.type === "file") {
					await Readable.toWeb(createReadStream(fullPath)).pipeTo(entryStream);
				} else {
					await entryStream.close(); // No body for non-file entries
				}
			}
			controller.finalize();
		} catch (err) {
			controller.error(err);
		}
	})();

	return Readable.fromWeb(readable);
}
