import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { createTarPacker } from "../tar/packer";
import type { TarHeader } from "../tar/types";
import { normalizeBody } from "../tar/utils";
import type { PackOptionsFS, TarSource } from "./types";

/**
 * Packs multiple sources into a tar archive as a Node.js Readable stream from an
 * array of sources (files, directories, or raw content).
 *
 * @param sources - An array of {@link TarSource} objects describing what to include.
 * @param options - Optional packing configuration using {@link PackOptionsFS}.
 * @returns A Node.js [`Readable`](https://nodejs.org/api/stream.html#class-streamreadable)
 * stream that outputs the tar archive bytes.
 *
 * @example
 * ```typescript
 * import { packTarSources, TarSource } from 'modern-tar/fs';
 *
 * const sources: TarSource[] = [
 * { type: 'file', source: './package.json', target: 'project/package.json' },
 * { type: 'directory', source: './src', target: 'project/src' },
 * { type: 'content', content: 'hello world', target: 'project/hello.txt' }
 * ];
 *
 * const archiveStream = packTarSources(sources);
 * await pipeline(archiveStream, createWriteStream('project.tar'));
 * ```
 */
export function packTarSources(
	sources: TarSource[],
	options: PackOptionsFS = {},
): Readable {
	const { dereference = false, filter, map, baseDir } = options;
	const stream = new Readable({ read() {} });

	const packer = createTarPacker(
		(chunk) => stream.push(Buffer.from(chunk)),
		(error) => stream.destroy(error),
		() => stream.push(null), // End the stream.
	);

	(async () => {
		try {
			// Use a stack for non-recursive depth-first traversal.
			const stack: TarSource[] = [...sources].reverse();
			const seenInodes = new Map<number, string>();
			const getStat = dereference ? fs.stat : fs.lstat;

			while (stack.length > 0) {
				// biome-ignore lint/style/noNonNullAssertion: Length checked above.
				const source = stack.pop()!;

				// Normalize paths to use forward slashes.
				const target = source.target.replace(/\\/g, "/");

				switch (source.type) {
					case "file": {
						// Skip unsafe symlinks when dereferencing.
						if (
							dereference &&
							baseDir &&
							(await isSymlinkUnsafe(source.source, baseDir))
						) {
							break;
						}

						const stat = await getStat(source.source);
						if (filter && !filter(source.source, stat)) break;

						let header: TarHeader = {
							name: target,
							size: 0,
							mode: stat.mode,
							mtime: stat.mtime,
							uid: stat.uid,
							gid: stat.gid,
							type: "file",
						};

						if (stat.isFile()) {
							header.size = stat.size;
							// Handle hardlinks by tracking inode numbers.
							if (stat.nlink > 1) {
								const linkTarget = seenInodes.get(stat.ino);
								if (linkTarget) {
									header.type = "link";
									header.linkname = linkTarget;
									header.size = 0;
								} else {
									seenInodes.set(stat.ino, header.name);
								}
							}
						} else if (stat.isSymbolicLink()) {
							header.type = "symlink";
							header.linkname = await fs.readlink(source.source);
							header.size = 0;
						} else {
							break; // Skip unsupported file types (FIFOs, sockets, etc.)
						}

						if (map) header = map(header);

						packer.add(header);

						// Stream file content directly to the packer.
						if (header.type === "file" && header.size > 0) {
							for await (const chunk of createReadStream(source.source)) {
								packer.write(chunk);
							}
						}
						packer.endEntry();
						break;
					}

					case "directory": {
						// Skip unsafe symlinks when dereferencing.
						if (
							dereference &&
							baseDir &&
							(await isSymlinkUnsafe(source.source, baseDir))
						) {
							break;
						}

						const stat = await getStat(source.source);
						if (filter && !filter(source.source, stat)) break;

						let header: TarHeader = {
							name: target.endsWith("/") ? target : `${target}/`,
							size: 0,
							mode: stat.mode,
							mtime: stat.mtime,
							uid: stat.uid,
							gid: stat.gid,
							type: "directory",
						};

						if (map) header = map(header);
						packer.add(header);
						packer.endEntry();

						// Add directory children to the stack for processing.
						const dirents = await fs.readdir(source.source, {
							withFileTypes: true,
						});

						for (let i = dirents.length - 1; i >= 0; i--) {
							const dirent = dirents[i];
							const childSourcePath = path.join(source.source, dirent.name);
							const childTargetPath = `${target.replace(/\/$/, "")}/${dirent.name}`;

							// Skip unsafe symlinks when dereferencing.
							if (
								baseDir &&
								dereference &&
								(await isSymlinkUnsafe(childSourcePath, baseDir))
							) {
								continue;
							}

							stack.push({
								type: dirent.isDirectory() ? "directory" : "file",
								source: childSourcePath,
								target: childTargetPath,
							});
						}

						break;
					}

					case "content": {
						const data = await normalizeBody(source.content);
						let header: TarHeader = {
							name: target,
							size: data.length,
							mode: source.mode ?? 0o644,
							type: "file",
						};

						if (map) header = map(header);
						packer.add(header);

						if (data.length > 0) packer.write(data);
						packer.endEntry();
						break;
					}
				}
			}
			packer.finalize();
		} catch (error) {
			stream.destroy(error as Error);
		}
	})();

	return stream;
}

/**
 * Pack a directory into a Node.js `Readable` stream. This is a convenience
 * wrapper around `packTarSources` that reads the contents of the specified directory.
 *
 * @param directoryPath - Path to directory to pack.
 * @param options - Optional packing configuration using {@link PackOptionsFS}.
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
	const stream = new Readable({ read() {} });

	(async () => {
		try {
			const resolvedPath = path.resolve(directoryPath);
			const dirents = await fs.readdir(resolvedPath, { withFileTypes: true });

			// Create sources for the top level contents of the directory.
			const allSources: TarSource[] = dirents.map((dirent) => ({
				type: dirent.isDirectory() ? "directory" : "file",
				source: path.join(resolvedPath, dirent.name),
				target: dirent.name,
			}));

			// Filter out unsafe symlinks when dereferencing.
			const sources: TarSource[] = [];
			for (const source of allSources) {
				if (
					source.type === "content" ||
					!options.dereference ||
					!(await isSymlinkUnsafe(source.source, resolvedPath))
				) {
					sources.push(source);
				}
			}

			// Forward data to our stream from source packer.
			const sourceStream = packTarSources(sources, {
				...options,
				baseDir: resolvedPath,
			});

			sourceStream.on("data", (chunk) => stream.push(chunk));
			sourceStream.on("end", () => stream.push(null));
			sourceStream.on("error", (err) => stream.destroy(err));
		} catch (error) {
			stream.destroy(error as Error);
		}
	})();

	return stream;
}

// If dereference is true, we need to ensure that the symlink target does not point outside baseDir.
async function isSymlinkUnsafe(
	sourcePath: string,
	baseDir: string,
): Promise<boolean> {
	try {
		const lstat = await fs.lstat(sourcePath);
		if (lstat.isSymbolicLink()) {
			const linkTarget = await fs.readlink(sourcePath);
			const resolvedTarget = path.resolve(path.dirname(sourcePath), linkTarget);
			return !resolvedTarget.startsWith(baseDir);
		}
	} catch {
		// If we can't read the symlink, it's safer to skip it
		return true;
	}

	return false;
}
