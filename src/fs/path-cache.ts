import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DIRECTORY, FILE, LINK, SYMLINK } from "../tar/constants";
import type { TarHeader } from "../tar/types";
import { createCache } from "./cache";
import { createFileSink, type FileSink } from "./file-sink";
import { normalizeHeaderName, normalizeUnicode, validateBounds } from "./path";
import type { UnpackOptionsFS } from "./types";

const ENOENT = "ENOENT";

// On Windows, both forward and backward slashes are valid path separators.
const linkSep = process.platform === "win32" ? /[/\\]/ : "/";

// Splits a symlink target into its path components, filtering out empty and "." parts.
const linkParts = (linkname: string): string[] =>
	linkname.split(linkSep).filter((part) => part && part !== ".");

/**
 * Creates a path validation, security check, and directory creation manager,
 * ensuring all filesystem writes are safe.
 *
 * Uses parallel execution for unrelated paths while serializing operations
 * within the same directory tree to prevent conflicts and TOCTOU attacks.
 */
export const createPathCache = (
	destDirPath: string,
	options: UnpackOptionsFS,
) => {
	const { maxDepth = 1024, dmode } = options;
	// Serializes directory creation operations within the same directory tree.
	const dirPromises = createCache<Promise<void>>();
	// Tracks path conflicts to prevent file/directory type mismatches.
	const pathConflicts = new Map<string, TarHeader["type"]>();
	// Stores hardlinks to be created after all files are written.
	const deferredLinks: Array<{ linkTarget: string; outPath: string }> = [];
	// Stores archive-created symlinks for final graph validation.
	let symlinks: Map<string, string> | undefined;
	// Without a real ".." component, symlink expansion cannot climb out.
	let hasParentRef = false;
	// Caches resolved real paths for symlinked directories.
	const realDirCache = createCache<Promise<string>>();

	// Initializes the destination directory.
	const initializeDestDir = async (destDirPath: string) => {
		const symbolic = normalizeUnicode(path.resolve(destDirPath));
		try {
			await fs.mkdir(symbolic, { recursive: true });
		} catch (err: unknown) {
			if ((err as NodeJS.ErrnoException).code === ENOENT) {
				// Handle race condition where parent directory was removed between resolve and mkdir.
				const parentDir = path.dirname(symbolic);
				if (parentDir === symbolic) throw err;

				// Ensure parent exists, then retry creating target directory.
				await fs.mkdir(parentDir, { recursive: true });
				await fs.mkdir(symbolic, { recursive: true });
			} else {
				throw err;
			}
		}

		try {
			// Get the real path to handle symlinks in destination directory.
			const real = await fs.realpath(symbolic);
			return { symbolic, real };
		} catch (err: unknown) {
			// Handle race condition where directory was deleted after mkdir.
			if ((err as NodeJS.ErrnoException).code === ENOENT)
				return { symbolic, real: symbolic };

			throw err;
		}
	};

	// Create destination directory first before any other operations.
	const destDirPromise = initializeDestDir(destDirPath);
	destDirPromise.catch(() => {
		// Prevent unhandled rejection when the stream is destroyed before any work is scheduled.
	});

	// Resolves a directory path to its real path and validates it is within bounds and caches
	// any resolved paths.
	const getRealDir = async (
		dirPath: string,
		errorMessage: string,
	): Promise<string> => {
		const destDir = await destDirPromise;

		// If it's the destination directory itself, we can skip realpath call.
		if (dirPath === destDir.symbolic) return destDir.real;

		// Check cache first.
		let promise = realDirCache.get(dirPath);
		if (!promise) {
			promise = fs.realpath(dirPath).then((realPath) => {
				validateBounds(realPath, destDir.real, errorMessage);
				return realPath;
			});

			realDirCache.set(dirPath, promise);
		}

		return promise;
	};

	// Ensures a directory exists.
	// Serializes operations within the same directory tree to prevent conflicts.
	const prepareDirectory = async (
		dirPath: string,
		mode?: number,
	): Promise<void> => {
		// Return existing promise if directory creation is already in progress.
		let promise = dirPromises.get(dirPath);
		if (promise) return promise;

		promise = (async () => {
			const destDir = await destDirPromise;

			// Skip if it's the destination directory (already exists).
			if (dirPath === destDir.symbolic) return;

			// Recursively ensure parent directory exists first.
			await prepareDirectory(path.dirname(dirPath));

			try {
				const stat = await fs.lstat(dirPath);

				// If path exists and is a directory, return early.
				if (stat.isDirectory()) return;

				// If path is a symlink, validate it points to a directory within bounds.
				if (stat.isSymbolicLink()) {
					try {
						const realPath = await getRealDir(
							dirPath,
							`Symlink "${dirPath}" points outside the extraction directory.`,
						);
						const realStat = await fs.stat(realPath);

						// If the symlink points to a directory, return early.
						if (realStat.isDirectory()) return;
					} catch (err) {
						if ((err as NodeJS.ErrnoException).code === ENOENT)
							throw new Error(
								`Symlink "${dirPath}" points outside the extraction directory.`,
							);

						throw err;
					}
				}

				// Path exists but is not a directory.
				throw new Error(`"${dirPath}" is not a valid directory component.`);
			} catch (err: unknown) {
				if ((err as NodeJS.ErrnoException).code === ENOENT) {
					// Path does not exist.
					await fs.mkdir(dirPath, { mode: mode ?? options.dmode });
					return;
				}

				throw err;
			}
		})();

		// Cache the promise to serialize future operations on this path.
		dirPromises.set(dirPath, promise);
		return promise;
	};

	return {
		/**
		 * Resolves once the destination directory has been initialized.
		 * Allows callers to wait for the mkdir to finish even if no entries are extracted.
		 */
		async ready(): Promise<void> {
			await destDirPromise;
		},
		/**
		 * Prepares a filesystem path for extraction based on TAR header.
		 * Handles security validation, conflict detection, and path preparation.
		 *
		 * @returns The file sink if the entry needs to be streamed.
		 */
		async preparePath(header: TarHeader): Promise<FileSink | undefined> {
			const { name, linkname, type, mode, mtime } = header;

			const normalizedName = normalizeHeaderName(name);
			const destDir = await destDirPromise;
			const outPath = path.join(destDir.symbolic, normalizedName);

			// Validate path doesn't escape extraction directory.
			validateBounds(
				outPath,
				destDir.symbolic,
				`Entry "${name}" points outside the extraction directory.`,
			);

			// Enforce maximum directory depth to prevent DoS attacks.
			if (maxDepth !== Infinity) {
				let depth = 1;
				for (const char of normalizedName)
					if (char === "/" && ++depth > maxDepth)
						throw new Error("Tar exceeds max specified depth.");
			}

			// Check if this path has already been processed.
			const prevOp = pathConflicts.get(normalizedName);
			if (prevOp) {
				// Detect hard conflicts (file vs directory type mismatches).
				if (
					(prevOp === DIRECTORY && type !== DIRECTORY) ||
					(prevOp !== DIRECTORY && type === DIRECTORY)
				)
					throw new Error(
						`Path conflict ${type} over existing ${prevOp} at "${name}"`,
					);

				// Soft conflict (same type), skip duplicate entry.
				return;
			}

			const parentDir = path.dirname(outPath);
			switch (type) {
				case DIRECTORY: {
					pathConflicts.set(normalizedName, DIRECTORY);

					// Strip SUID/SGID/Sticky bits for security.
					const safeMode = mode ? mode & 0o777 : undefined;
					// Create directory with mode from header or default.
					await prepareDirectory(outPath, dmode ?? safeMode);

					// Set directory modification time.
					if (mtime)
						await fs.lutimes(outPath, mtime, mtime).catch(() => {
							// Skip errors.
						});

					return;
				}

				case FILE: {
					pathConflicts.set(normalizedName, FILE);
					await prepareDirectory(parentDir);
					const safeMode = mode ? mode & 0o777 : undefined;
					return createFileSink(outPath, destDir.real, {
						mode: options.fmode ?? safeMode,
						mtime,
					});
				}

				case SYMLINK: {
					pathConflicts.set(normalizedName, SYMLINK);

					// Handle empty linkname.
					if (!linkname) return;

					// Validate the lexical symlink target before writing the link.
					validateBounds(
						path.resolve(parentDir, linkname),
						destDir.symbolic,
						`Symlink "${linkname}" points outside the extraction directory.`,
					);

					await prepareDirectory(parentDir);

					// Reject parent swaps between leaf removal and link creation.
					const realParentDir = await fs.realpath(parentDir);
					validateBounds(
						realParentDir,
						destDir.real,
						"Symlink parent changed.",
					);
					validateBounds(
						path.resolve(realParentDir, linkname),
						destDir.real,
						`Symlink "${linkname}" points outside the extraction directory.`,
					);
					const realOutPath = path.join(realParentDir, path.basename(outPath));

					try {
						await fs.symlink(linkname, realOutPath);
					} catch (err) {
						if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
						await fs.rm(realOutPath, { force: true });
						if ((await fs.realpath(parentDir)) !== realParentDir)
							throw new Error("Symlink parent changed.");
						await fs.symlink(linkname, realOutPath);
					}
					(symlinks ??= new Map()).set(normalizedName, linkname);

					// Empty and "." parts do not matter when only detecting "..".
					hasParentRef ||=
						linkname.includes("..") && linkname.split(linkSep).includes("..");

					// Set symlink modification time.
					if (mtime)
						await fs.lutimes(outPath, mtime, mtime).catch(() => {
							// Skip errors.
						});

					return;
				}

				case LINK: {
					pathConflicts.set(normalizedName, LINK);

					// Handle empty linkname.
					if (!linkname) return;

					// Hardlinks must be relative paths.
					const normalizedLink = normalizeUnicode(linkname);
					if (path.isAbsolute(normalizedLink))
						throw new Error(
							`Hardlink "${linkname}" points outside the extraction directory.`,
						);

					// Build and validate hardlink target path.
					const linkTarget = path.join(destDir.symbolic, normalizedLink);
					validateBounds(
						linkTarget,
						destDir.symbolic,
						`Hardlink "${linkname}" points outside the extraction directory.`,
					);

					// Defer hardlink creation until after all files are written.
					await prepareDirectory(parentDir);
					if (linkTarget !== outPath) {
						deferredLinks.push({ linkTarget, outPath });
					}

					return;
				}

				default:
					// Unknown entry type.
					return;
			}
		},

		/**
		 * Validates archive-created symlinks against the final destination state.
		 *
		 * Catches symlink chains whose final target changes after a later archive
		 * entry creates another symlink.
		 */
		async checkSymlinks() {
			if (!symlinks) return;

			const { symbolic: dest, real } = await destDirPromise;
			const root = path.parse(dest).root;
			const depth = linkParts(dest.slice(root.length)).length;
			for (const [name, linkname] of symlinks) {
				const outPath = path.join(dest, name);
				const message = `Symlink "${linkname}" points outside the extraction directory.`;
				try {
					validateBounds(await fs.realpath(outPath), real, message);
					continue;
				} catch (err: unknown) {
					if ((err as NodeJS.ErrnoException).code !== ENOENT) {
						await fs.rm(outPath, { force: true });
						throw err;
					}
				}
				if (!hasParentRef) continue;

				// Stored absolute linknames already passed the creation-time bounds check.
				// Strip the destination prefix here while preserving later ".." parts.
				let pendingParts: string[];
				if (path.isAbsolute(linkname)) {
					pendingParts = linkParts(linkname.slice(root.length));
					pendingParts.splice(0, depth);
				} else {
					pendingParts = linkParts(`${path.posix.dirname(name)}/${linkname}`);
				}
				const resolvedParts: string[] = [];
				let followedSymlinks = 0;

				for (let i = 0; i < pendingParts.length; i++) {
					const part = pendingParts[i];

					if (part === "..") {
						if (!resolvedParts.length) {
							await fs.rm(outPath, { force: true });
							throw new Error(message);
						}

						resolvedParts.pop();
						continue;
					}

					resolvedParts.push(part);

					const nextLink = symlinks.get(resolvedParts.join("/"));
					if (!nextLink) continue;

					// More follows than archive-created symlinks means this graph is cycling.
					if (++followedSymlinks > symlinks.size) {
						await fs.rm(outPath, { force: true });
						throw new Error(message);
					}

					// Expand symlink components before applying following ".." parts, which
					// matches filesystem lookup order and catches "noop/.." chain attacks.
					resolvedParts.pop();
					if (path.isAbsolute(nextLink)) {
						resolvedParts.length = 0;
						const nextParts = linkParts(nextLink.slice(root.length));
						nextParts.splice(0, depth);
						pendingParts.splice(i + 1, 0, ...nextParts);
					} else {
						pendingParts.splice(i + 1, 0, ...linkParts(nextLink));
					}
				}
			}
		},

		/**
		 * Creates all deferred hardlinks after file extraction is complete.
		 * This ensures hardlink targets exist before creating the links.
		 */
		async applyLinks() {
			const destRoot = (await destDirPromise).real;
			for (const { linkTarget, outPath } of deferredLinks) {
				try {
					const realTargetDir = await fs.realpath(path.dirname(linkTarget));
					validateBounds(
						realTargetDir,
						destRoot,
						`Hardlink "${linkTarget}" points outside the extraction directory.`,
					);
					const realTarget = path.join(
						realTargetDir,
						path.basename(linkTarget),
					);
					const targetStat = await fs.lstat(realTarget);
					if (targetStat.isSymbolicLink())
						throw new Error(`Hardlink "${linkTarget}" is a symlink.`);

					const realOutDir = await fs.realpath(path.dirname(outPath));
					validateBounds(
						realOutDir,
						destRoot,
						`Hardlink "${outPath}" points outside the extraction directory.`,
					);
					const realOutPath = path.join(realOutDir, path.basename(outPath));

					await fs.rm(realOutPath, { force: true });
					await fs.link(realTarget, realOutPath);

					const linkStat = await fs.lstat(realOutPath);
					if (
						linkStat.dev !== targetStat.dev ||
						linkStat.ino !== targetStat.ino
					) {
						await fs.rm(realOutPath, { force: true });
						throw new Error(
							`Hardlink target "${linkTarget}" changed during creation for link at "${outPath}".`,
						);
					}
				} catch (err: unknown) {
					if ((err as NodeJS.ErrnoException).code === ENOENT)
						throw new Error(
							`Hardlink target "${linkTarget}" does not exist for link at "${outPath}".`,
						);

					throw err;
				}
			}
		},
	};
};
