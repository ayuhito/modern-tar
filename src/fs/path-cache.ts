import type { Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DIRECTORY, FILE, LINK, SYMLINK } from "../tar/constants";
import type { TarHeader } from "../tar/types";
import { createCache } from "./cache";
import type { createOperationQueue } from "./concurrency";
import { normalizeHeaderName, validateBounds } from "./path";
import type { UnpackOptionsFS } from "./types";

const ENOENT = "ENOENT";
const MAX_SYMLINKS = 64;

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
	opQueue: ReturnType<typeof createOperationQueue>,
	concurrency: number,
	checkCancelled: () => void,
) => {
	const { maxDepth = 1024, dmode } = options;
	// Serializes directory creation operations within the same directory tree.
	const dirPromises = createCache<Promise<void>>();
	// Tracks path conflicts to prevent file/directory type mismatches.
	const pathConflicts = new Map<string, TarHeader["type"]>();
	// Stores hardlinks to be created after all files are written.
	const deferredLinks: Array<{ linkTarget: string; outPath: string }> = [];
	// Stores archive-created symlinks for final validation.
	let symlinks: Array<[string, string]> | undefined;
	// Caches resolved real paths for symlinked directories.
	const realDirCache = createCache<Promise<string>>();

	// Initializes the destination directory.
	const initializeDestDir = async (destDirPath: string) => {
		const symbolic = path.resolve(destDirPath);
		try {
			await fs.mkdir(symbolic, { recursive: true });
		} catch (err: unknown) {
			if ((err as NodeJS.ErrnoException).code === ENOENT) {
				// Handle race condition where parent directory was removed between resolve and mkdir.
				const parentDir = path.dirname(symbolic);
				if (parentDir === symbolic) throw err;

				// Ensure parent exists, then retry creating target directory.
				checkCancelled();
				await fs.mkdir(parentDir, { recursive: true });
				checkCancelled();
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
		checkCancelled();

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

		const realPath = await promise;
		checkCancelled();
		return realPath;
	};

	// Ensures a directory exists.
	// Serializes operations within the same directory tree to prevent conflicts.
	const prepareDirectory = async (
		dirPath: string,
		mode?: number,
	): Promise<void> => {
		// Return existing promise if directory creation is already in progress.
		let promise = dirPromises.get(dirPath);
		if (promise) {
			await promise;
			checkCancelled();
			return;
		}

		promise = (async () => {
			const destDir = await destDirPromise;
			checkCancelled();

			// Skip if it's the destination directory (already exists).
			if (dirPath === destDir.symbolic) return;

			// Recursively ensure parent directory exists first.
			await prepareDirectory(path.dirname(dirPath));
			checkCancelled();

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
					checkCancelled();
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
			checkCancelled();
		},
		/**
		 * Prepares a filesystem path for extraction based on TAR header.
		 * Handles security validation, conflict detection, and path preparation.
		 *
		 * @returns The output path if the entry is a file that needs to be streamed.
		 */
		async preparePath(header: TarHeader): Promise<string | undefined> {
			checkCancelled();
			const { name, linkname, type, mode, mtime } = header;

			const normalizedName = normalizeHeaderName(name);
			const destDir = await destDirPromise;
			checkCancelled();
			const outPath = path.join(destDir.symbolic, normalizedName);

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
					if (mtime) {
						checkCancelled();
						await fs.lutimes(outPath, mtime, mtime).catch(() => {
							// Skip errors.
						});
					}

					return;
				}

				case FILE: {
					pathConflicts.set(normalizedName, FILE);
					await prepareDirectory(parentDir);
					checkCancelled();
					// Anchor the file to its validated real parent before its open
					// overlaps later entries.
					return path.join(
						await getRealDir(
							parentDir,
							`File "${name}" points outside the extraction directory.`,
						),
						path.basename(outPath),
					);
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
					checkCancelled();

					// Reject parent swaps between leaf removal and link creation.
					const realParentDir = await fs.realpath(parentDir);
					checkCancelled();
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
						checkCancelled();
						await fs.rm(realOutPath, { force: true });
						checkCancelled();
						if ((await fs.realpath(parentDir)) !== realParentDir)
							throw new Error("Symlink parent changed.");
						checkCancelled();
						await fs.symlink(linkname, realOutPath);
					}
					checkCancelled();
					(symlinks ??= []).push([normalizedName, linkname]);
					// A symlink can change the meaning of any cached descendant path.
					dirPromises.clear();
					realDirCache.clear();

					// Set symlink modification time.
					if (mtime) {
						checkCancelled();
						await fs.lutimes(outPath, mtime, mtime).catch(() => {
							// Skip errors.
						});
					}

					return;
				}

				case LINK: {
					pathConflicts.set(normalizedName, LINK);

					// Handle empty linkname.
					if (!linkname) return;

					// Hardlinks must be relative paths.
					if (path.isAbsolute(linkname))
						throw new Error(
							`Hardlink "${linkname}" points outside the extraction directory.`,
						);

					// Build and validate hardlink target path.
					const linkTarget = path.join(destDir.symbolic, linkname);
					validateBounds(
						linkTarget,
						destDir.symbolic,
						`Hardlink "${linkname}" points outside the extraction directory.`,
					);

					// Defer hardlink creation until after all files are written.
					await prepareDirectory(parentDir);
					checkCancelled();
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
			checkCancelled();
			if (!symlinks) return;

			const { symbolic: dest, real } = await destDirPromise;
			checkCancelled();
			// realpath results are canonical, so reuse one boundary prefix instead of
			// resolving both paths again for every symlink.
			const realPrefix = real + path.sep;
			const root = path.parse(real).root;
			const depth = linkParts(real.slice(root.length)).length;
			const targetParts = (
				linkname: string,
				resolvedParts: string[],
				message: string,
			) => {
				if (!path.isAbsolute(linkname)) return linkParts(linkname);
				validateBounds(linkname, real, message);
				resolvedParts.length = 0;
				const parts = linkParts(linkname.slice(root.length));
				parts.splice(0, depth);
				return parts;
			};
			// Return errors as values so each batch can report them in archive order.
			const getSymlinkError = async ([name, storedLinkname]: [
				string,
				string,
			]): Promise<unknown | undefined> => {
				const outPath = path.join(dest, name);
				try {
					try {
						const resolved = await fs.realpath(outPath);
						if (resolved !== real && !resolved.startsWith(realPrefix))
							throw new Error(
								`Symlink "${storedLinkname}" points outside the extraction directory.`,
							);
						return;
					} catch (err: unknown) {
						if ((err as NodeJS.ErrnoException).code !== ENOENT) throw err;
					}

					if (!(await fs.lstat(outPath)).isSymbolicLink()) return;
					const linkname = await fs.readlink(outPath);
					const message = `Symlink "${linkname}" points outside the extraction directory.`;
					const realParent = await fs.realpath(path.dirname(outPath));
					validateBounds(realParent, real, message);
					const resolvedParts = linkParts(path.relative(real, realParent));
					const pendingParts = targetParts(linkname, resolvedParts, message);
					let followedSymlinks = 0;

					for (let i = 0; i < pendingParts.length; i++) {
						const part = pendingParts[i];
						if (part === "..") {
							if (!resolvedParts.length) throw new Error(message);
							resolvedParts.pop();
							continue;
						}

						resolvedParts.push(part);
						const nextPath = path.join(real, ...resolvedParts);
						let nextStat: Stats;
						try {
							nextStat = await fs.lstat(nextPath);
						} catch (err: unknown) {
							if ((err as NodeJS.ErrnoException).code === ENOENT) continue;
							throw err;
						}
						if (!nextStat.isSymbolicLink()) continue;
						if (++followedSymlinks > MAX_SYMLINKS) throw new Error(message);

						const nextLink = await fs.readlink(nextPath);
						resolvedParts.pop();
						pendingParts.splice(
							i + 1,
							0,
							...targetParts(nextLink, resolvedParts, message),
						);
					}
				} catch (err: unknown) {
					if ((err as NodeJS.ErrnoException).code !== ENOENT) return err;
				}
			};

			// Validate concurrently without queuing the entire archive at once.
			for (let start = 0; start < symlinks.length; start += concurrency) {
				checkCancelled();
				const batch = symlinks.slice(start, start + concurrency);
				const errors = await Promise.all(
					batch.map((symlink) => opQueue.add(() => getSymlinkError(symlink))),
				);
				checkCancelled();
				for (const [i, error] of errors.entries()) {
					if (error === undefined) continue;
					await fs.rm(path.join(dest, batch[i][0]), { force: true });
					throw error;
				}
			}
		},

		/**
		 * Creates all deferred hardlinks after file extraction is complete.
		 * This ensures hardlink targets exist before creating the links.
		 */
		async applyLinks() {
			checkCancelled();
			const destRoot = (await destDirPromise).real;
			checkCancelled();
			for (const { linkTarget, outPath } of deferredLinks) {
				try {
					const realTargetDir = await fs.realpath(path.dirname(linkTarget));
					checkCancelled();
					validateBounds(
						realTargetDir,
						destRoot,
						`Hardlink "${linkTarget}" points outside the extraction directory.`,
					);
					const realTarget = path.join(
						realTargetDir,
						path.basename(linkTarget),
					);
					// These reads are independent. Queue and settle both to preserve the
					// configured concurrency and error order.
					const [targetResult, outDirResult] = await Promise.allSettled([
						opQueue.add(() => fs.lstat(realTarget)),
						opQueue.add(() => fs.realpath(path.dirname(outPath))),
					]);
					checkCancelled();
					if (targetResult.status === "rejected") throw targetResult.reason;
					const targetStat = targetResult.value;
					if (targetStat.isSymbolicLink())
						throw new Error(`Hardlink "${linkTarget}" is a symlink.`);

					if (outDirResult.status === "rejected") throw outDirResult.reason;
					const realOutDir = outDirResult.value;
					validateBounds(
						realOutDir,
						destRoot,
						`Hardlink "${outPath}" points outside the extraction directory.`,
					);
					const realOutPath = path.join(realOutDir, path.basename(outPath));

					try {
						await fs.link(realTarget, realOutPath);
					} catch (err: unknown) {
						const code = (err as NodeJS.ErrnoException).code;
						if (code !== "EEXIST" && code !== ENOENT) throw err;

						try {
							const outStat = await fs.lstat(realOutPath);
							checkCancelled();
							if (
								outStat.dev === targetStat.dev &&
								outStat.ino === targetStat.ino
							)
								continue;
							await fs.rm(realOutPath, { force: true });
						} catch (err: unknown) {
							if ((err as NodeJS.ErrnoException).code !== ENOENT) throw err;
						}

						checkCancelled();
						await fs.link(realTarget, realOutPath);
					}

					const linkStat = await fs.lstat(realOutPath);
					checkCancelled();
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
