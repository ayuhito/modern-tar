import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { BLOCK_SIZE, BLOCK_SIZE_MASK } from "../web/constants";
import { createTarHeader } from "../web/pack";
import { generatePax } from "../web/pack-pax";
import type { TarHeader } from "../web/types";
import type { PackOptionsFS } from "./types";

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
 * import { packTar } from 'modern-tar/fs';
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
	const seenInodes = new Map<number, string>();

	async function* walk(
		currentPath: string, // The relative path inside the tar archive
	): AsyncGenerator<Uint8Array | Buffer> {
		const fullPath = path.join(directoryPath, currentPath);
		const stat = await (options.dereference
			? fs.stat(fullPath)
			: fs.lstat(fullPath));

		if (options.filter?.(fullPath, stat) === false) {
			return;
		}

		// Header creation logic remains largely the same
		const header: TarHeader = {
			name: currentPath.replace(/\\/g, "/"),
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

		// Handle other file types
		if (header.type !== "link") {
			if (stat.isDirectory()) {
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
		}

		const finalHeader = options.map ? options.map(header) : header;

		// Automatically generate and yield a PAX header if needed.
		const paxData = generatePax(finalHeader);
		if (paxData) {
			yield paxData.paxHeader;
			yield paxData.paxBody;

			const paxPadding = -paxData.paxBody.length & BLOCK_SIZE_MASK;
			if (paxPadding > 0) {
				yield Buffer.alloc(paxPadding);
			}
		}

		yield createTarHeader(finalHeader);

		// Yield file content and padding
		if (finalHeader.type === "file" && finalHeader.size > 0) {
			yield* createReadStream(fullPath);
			const paddingSize = -finalHeader.size & BLOCK_SIZE_MASK;
			if (paddingSize > 0) {
				yield Buffer.alloc(paddingSize);
			}
		}

		// If it's a directory, recurse into its children
		if (stat.isDirectory()) {
			const dirents = await fs.readdir(fullPath);
			for (const dirent of dirents) {
				yield* walk(path.join(currentPath, dirent));
			}
		}
	}

	return Readable.from(
		(async function* () {
			const topLevelDirents = await fs.readdir(directoryPath);
			for (const dirent of topLevelDirents) {
				yield* walk(dirent);
			}

			// End with two zero-filled blocks
			yield Buffer.alloc(BLOCK_SIZE * 2);
		})(),
	);
}
