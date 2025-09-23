import { createReadStream, type Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import type { TarHeader } from "@modern-tar/core";
import { createTarDecoder, createTarPacker } from "@modern-tar/core";

/**
 * Options for extracting tar archives to the filesystem.
 */
export interface ExtractOptions {
	/** Number of leading path components to strip from entry names */
	strip?: number;
	/** Filter function to determine which entries to extract */
	filter?: (header: TarHeader) => boolean;
	/** Transform function to modify headers before extraction */
	map?: (header: TarHeader) => TarHeader;
}

/**
 * Options for packing directories into tar archives.
 */
export interface PackOptions {
	/** Follow symlinks instead of archiving them as symlinks */
	dereference?: boolean;
	/** Filter function to determine which files to include */
	filter?: (path: string, stat: Stats) => boolean;
	/** Transform function to modify headers before packing */
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
 * Pack a directory into a streaming tar archive.
 *
 * Returns a ReadableStream that produces tar archive bytes as the directory
 * is being walked. Memory efficient for large directories.
 *
 * @param directoryPath - Path to directory to pack
 * @param options - Packing options
 * @returns ReadableStream of tar archive bytes
 *
 * @example
 * ```typescript
 * import { packTar } from '@modern-tar/fs';
 * import { createWriteStream } from 'node:fs';
 * import { Writable } from 'node:stream';
 *
 * const tarStream = packTar('/my/directory');
 * const fileStream = Writable.toWeb(createWriteStream('archive.tar'));
 * await tarStream.pipeTo(fileStream);
 *
 * // With filtering
 * const filteredStream = packTar('/my/directory', {
 *   filter: (filePath, stat) => !filePath.includes('node_modules')
 * });
 * ```
 */
export function packTar(
	directoryPath: string,
	options: PackOptions = {},
): ReadableStream<Uint8Array> {
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

	return readable;
}

/**
 * Extract a tar archive to a directory.
 *
 * Returns a WritableStream to pipe tar archive bytes into. Files, directories,
 * symlinks, and hard links are written to the filesystem with correct permissions
 * and timestamps.
 *
 * @param directoryPath - Path to directory where files will be extracted
 * @param options - Extraction options for filtering, mapping, and path manipulation
 * @returns WritableStream to pipe tar archive bytes into
 *
 * @example
 * ```typescript
 * import { packTar, unpackTar } from '@modern-tar/fs';
 * import { createReadStream } from 'node:fs';
 * import { Readable } from 'node:stream';
 *
 * // Basic streaming extraction
 * const tarStream = Readable.toWeb(createReadStream('archive.tar'));
 * await tarStream.pipeTo(unpackTar('/output/directory'));
 *
 * // Extract with path stripping
 * const tarStream2 = Readable.toWeb(createReadStream('archive.tar'));
 * await tarStream2.pipeTo(unpackTar('/output/directory', {
 *   strip: 1  // Remove first path component
 * }));
 *
 * // Extract with filtering
 * const tarStream3 = Readable.toWeb(createReadStream('archive.tar'));
 * await tarStream3.pipeTo(unpackTar('/output/directory', {
 *   filter: (header) => !header.name.includes('.tmp')
 * }));
 * ```
 */
export function unpackTar(
	directoryPath: string,
	options: ExtractOptions = {},
): WritableStream<Uint8Array> {
	const chunks: Uint8Array[] = [];

	return new WritableStream({
		write(chunk) {
			chunks.push(chunk);
		},
		async close() {
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
						// biome-ignore lint/style/noNonNullAssertion: Symlinks always have linkname.
						await fs.symlink(header.linkname!, outPath);
						break;
					case "link":
						// biome-ignore lint/style/noNonNullAssertion: Hard links always have linkname.
						await fs.link(path.join(directoryPath, header.linkname!), outPath);
						break;
				}

				// Apply timestamps.
				if (header.mtime) {
					try {
						const utimesFn = header.type === "symlink" ? fs.lutimes : fs.utimes;
						await utimesFn(outPath, header.mtime, header.mtime);
					} catch {}
				}
			}
		},
	});
}
