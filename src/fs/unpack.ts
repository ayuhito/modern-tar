import { createWriteStream, type Stats } from "node:fs";
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
		const resolvedDestDir = normalizePath(path.resolve(directoryPath));
		const validatedDirs = new Set<string>([resolvedDestDir]);

		// Ensure destination directory exists upfront
		await fs.mkdir(resolvedDestDir, { recursive: true });

		const entryStream = readable
			.pipeThrough(createTarDecoder())
			.pipeThrough(createTarOptionsTransformer(options));

		const reader = entryStream.getReader();
		try {
			// Prevent DoS attacks with deeply nested paths
			const maxDepth = options.maxDepth ?? 1024;

			while (true) {
				const { done, value: entry } = await reader.read();
				if (done) break;

				const { header } = entry;
				const normalizedName = normalizePath(header.name);

				// Check path depth to prevent DoS attacks
				if (maxDepth !== Infinity) {
					const depth = normalizedName.split("/").length;

					if (depth > maxDepth) {
						throw new Error(
							`Path depth of entry "${header.name}" (${depth}) exceeds the maximum allowed depth of ${maxDepth}.`,
						);
					}
				}

				// Check for absolute paths in the entry name
				if (path.isAbsolute(normalizedName)) {
					throw new Error(
						`Path traversal attempt detected for entry "${header.name}".`,
					);
				}

				const outPath = path.join(resolvedDestDir, normalizedName);

				validateBounds(
					outPath,
					resolvedDestDir,
					`Path traversal attempt detected for entry "${header.name}".`,
				);

				const parentDir = path.dirname(outPath);

				await validatePath(parentDir, resolvedDestDir, validatedDirs);
				await fs.mkdir(parentDir, { recursive: true });

				switch (header.type) {
					case "directory": {
						const mode = options.dmode ?? header.mode;
						await fs.mkdir(outPath, {
							recursive: true,
							mode,
						});

						validatedDirs.add(outPath);
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
							validateBounds(
								resolvedTarget,
								resolvedDestDir,
								`Symlink target "${header.linkname}" points outside the extraction directory.`,
							);
						}
						await fs.symlink(header.linkname, outPath);

						// This prevents cache poisoning attacks where a directory is replaced by a symlink.
						//
						// Invalidate the whole cache on Windows, because Windows normalizes paths aggressively.
						// Other platforms, we can just remove the specific directory from the cache.
						if (process.platform === "win32") {
							validatedDirs.clear();
							validatedDirs.add(resolvedDestDir);
						} else {
							validatedDirs.delete(outPath);
						}

						break;
					}

					case "link": {
						if (!header.linkname) break;

						const normalizedLinkname = normalizePath(header.linkname);

						// Check for absolute paths in hardlink target
						if (path.isAbsolute(normalizedLinkname)) {
							throw new Error(
								`Hardlink target "${header.linkname}" points outside the extraction directory.`,
							);
						}

						const resolvedLinkTarget = path.resolve(
							resolvedDestDir,
							normalizedLinkname,
						);
						validateBounds(
							resolvedLinkTarget,
							resolvedDestDir,
							`Hardlink target "${header.linkname}" points outside the extraction directory.`,
						);

						await validatePath(
							path.dirname(resolvedLinkTarget),
							resolvedDestDir,
							validatedDirs,
						);

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

/**
 * Recursively validates that each item of the given path exists and is a directory or
 * a safe symlink.
 *
 * We need to call this for each path component to ensure that no symlinks escape the
 * target directory.
 */
async function validatePath(
	currentPath: string,
	root: string,
	cache: Set<string>,
) {
	const normalizedPath = normalizePath(currentPath);

	// If the path is the root or is already in our cache, we're done.
	if (normalizedPath === root || cache.has(normalizedPath)) {
		return;
	}

	let stat: Stats;
	try {
		stat = await fs.lstat(normalizedPath);
	} catch (err) {
		if (
			err instanceof Error &&
			"code" in err &&
			(err.code === "ENOENT" || err.code === "EPERM")
		) {
			// Path component doesn't exist, so we must validate its parent.
			await validatePath(path.dirname(normalizedPath), root, cache);
			cache.add(normalizedPath);

			return;
		}

		throw err;
	}

	// If a component is a directory, validate its parent and then cache it.
	if (stat.isDirectory()) {
		await validatePath(path.dirname(normalizedPath), root, cache);
		cache.add(normalizedPath);

		return;
	}

	// If we encounter a symlink, we need to check where it points.
	if (stat.isSymbolicLink()) {
		const realPath = await fs.realpath(normalizedPath);

		// Check if the symlink target is within our root directory.
		validateBounds(
			realPath,
			root,
			`Path traversal attempt detected: symlink "${currentPath}" points outside the extraction directory.`,
		);

		// Validate the parent and cache this symlink as safe
		await validatePath(path.dirname(normalizedPath), root, cache);
		cache.add(normalizedPath);

		return;
	}

	// Any other file type is an invalid component for a directory path.
	throw new Error(
		`Path traversal attempt detected: "${currentPath}" is not a valid directory component.`,
	);
}

/* Validates that the given target path is within the destination directory and does not escape. */
function validateBounds(
	targetPath: string,
	destDir: string,
	errorMessage: string,
): void {
	const normalizedTarget = normalizePath(targetPath);
	if (
		!(
			normalizedTarget === destDir ||
			normalizedTarget.startsWith(destDir + path.sep)
		)
	) {
		throw new Error(errorMessage);
	}
}

/**
 * Normalizes a file path to prevent Unicode-based security vulnerabilities.
 *
 * This prevents cache poisoning attacks where different Unicode representations
 * of the same visual path (e.g., "café" vs "cafe´") could bypass validation.
 */
function normalizePath(pathStr: string): string {
	return pathStr.normalize("NFKD");
}
