import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { BLOCK_SIZE, BLOCK_SIZE_MASK } from "../web/constants";
import { createTarHeader } from "../web/pack";
import { generatePax } from "../web/pack-pax";
import type { TarHeader } from "../web/types";
import type { PackOptionsFS } from "./types";

const ZERO_BUFFER = Buffer.alloc(BLOCK_SIZE);
const EOF_BUFFER = Buffer.alloc(BLOCK_SIZE * 2);

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
	const { dereference, filter, map } = options;
	const seenInodes = new Map<number, string>();
	const getStat = dereference ? fs.stat : fs.lstat;

	async function* walk(
		currentPath: string, // The relative path inside the tar archive
	): AsyncGenerator<Uint8Array | Buffer> {
		const fullPath = path.join(directoryPath, currentPath);
		const stat = await getStat(fullPath);

		if (filter?.(fullPath, stat) === false) return;

		let header: TarHeader = {
			name: currentPath.replaceAll("\\", "/"),
			mode: stat.mode,
			mtime: stat.mtime,
			uid: stat.uid,
			gid: stat.gid,
			size: 0,
			type: "file",
		};

		if (stat.isFile()) {
			header.size = stat.size;

			// Handle hardlinks.
			if (stat.nlink > 1) {
				const linkTarget = seenInodes.get(stat.ino);
				if (linkTarget) {
					header.type = "link";
					header.linkname = linkTarget;
					header.size = 0; // Hardlink headers have size 0.
				} else {
					seenInodes.set(stat.ino, header.name);
				}
			}
		} else if (stat.isDirectory()) {
			header.type = "directory";
			if (!header.name.endsWith("/")) header.name += "/";
		} else if (stat.isSymbolicLink()) {
			header.type = "symlink";
			header.linkname = await fs.readlink(fullPath);
		}

		header = map?.(header) ?? header;

		// Automatically generate and yield a PAX header if needed.
		const pax = generatePax(header);
		if (pax) {
			yield pax.paxHeader;
			yield pax.paxBody;
			const padding = -pax.paxBody.length & BLOCK_SIZE_MASK;
			if (padding > 0) yield ZERO_BUFFER.subarray(0, padding);
		}

		yield createTarHeader(header);

		// Yield file content and padding
		if (header.type === "file" && header.size > 0) {
			yield* createReadStream(fullPath);
			const padding = -header.size & BLOCK_SIZE_MASK;
			if (padding > 0) yield ZERO_BUFFER.subarray(0, padding);
		}

		if (stat.isDirectory()) {
			const dirents = await fs.readdir(fullPath, { withFileTypes: true });
			for (const dirent of dirents) {
				yield* walk(path.join(currentPath, dirent.name));
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
			yield EOF_BUFFER;
		})(),
	);
}
