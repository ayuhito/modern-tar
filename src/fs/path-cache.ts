import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DIRECTORY, FILE, LINK, SYMLINK } from "../tar/constants";
import type { TarHeader } from "../tar/types";
import { normalizeHeaderName, normalizeUnicode, validateBounds } from "./path";
import type { UnpackOptionsFS } from "./types";

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
	// Serializes directory creation operations within the same directory tree.
	const dirPromises = new Map<string, Promise<void>>();
	// Tracks path conflicts to prevent file/directory type mismatches.
	const pathConflicts = new Map<string, TarHeader["type"]>();
	// Stores hardlinks to be created after all files are written.
	const deferredLinks: Array<{ linkTarget: string; outPath: string }> = [];
	// Caches resolved real paths for symlinked directories.
	const realDirCache = new Map<string, Promise<string>>();

	// Initializes the destination directory.
	const initializeDestDir = async (destDirPath: string) => {
		const symbolic = normalizeUnicode(path.resolve(destDirPath));
		try {
			await fs.mkdir(symbolic, { recursive: true });
		} catch (err: unknown) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
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
			if ((err as NodeJS.ErrnoException).code === "ENOENT")
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
		if (dirPath === destDir.symbolic) {
			validateBounds(destDir.real, destDir.real, errorMessage);
			return destDir.real;
		}

		// Check cache first.
		let promise = realDirCache.get(dirPath);
		if (!promise) {
			promise = fs.realpath(dirPath).then((realPath) => {
				validateBounds(realPath, destDir.real, errorMessage);
				return realPath;
			});

			realDirCache.set(dirPath, promise);
		}

		const realDir = await promise;
		validateBounds(realDir, destDir.real, errorMessage);
		return realDir;
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
						if ((err as NodeJS.ErrnoException).code === "ENOENT")
							throw new Error(
								`Symlink "${dirPath}" points outside the extraction directory.`,
							);

						throw err;
					}
				}

				// Path exists but is not a directory.
				throw new Error(`"${dirPath}" is not a valid directory component.`);
			} catch (err: unknown) {
				if ((err as NodeJS.ErrnoException).code === "ENOENT") {
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
		 * Prepares a filesystem path for extraction based on TAR header.
		 * Handles security validation, conflict detection, and path preparation.
		 */
		async preparePath(header: TarHeader): Promise<{
			outPath: string;
			type: "file" | "link" | "symlink" | "dir" | "skip";
		}> {
			const { name, linkname, type, mode, mtime } = header;
			const { maxDepth = 1024, dmode } = options;

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
				return { outPath, type: "skip" as const };
			}

			const parentDir = path.dirname(outPath);
			switch (type) {
				case DIRECTORY: {
					pathConflicts.set(normalizedName, DIRECTORY);

					// Create directory with mode from header or default.
					await prepareDirectory(outPath, dmode ?? mode);

					// Set directory modification time.
					if (mtime)
						await fs.lutimes(outPath, mtime, mtime).catch(() => {
							// Skip errors.
						});

					return { outPath, type: "dir" as const };
				}

				case FILE: {
					pathConflicts.set(normalizedName, FILE);
					await prepareDirectory(parentDir);
					return { outPath, type: "file" as const };
				}

				case SYMLINK: {
					pathConflicts.set(normalizedName, SYMLINK);

					// Handle empty linkname.
					if (!linkname) return { outPath, type: "symlink" as const };

					await prepareDirectory(parentDir);

					// Validate symlink target stays within extraction directory
					const linkTargetPath = path.resolve(parentDir, linkname);
					validateBounds(
						linkTargetPath,
						destDir.symbolic,
						`Symlink "${linkname}" points outside the extraction directory.`,
					);

					// Create the symlink.
					await fs.symlink(linkname, outPath);

					// Set symlink modification time.
					if (mtime)
						await fs.lutimes(outPath, mtime, mtime).catch(() => {
							// Skip errors.
						});

					return { outPath, type: "symlink" as const };
				}

				case LINK: {
					pathConflicts.set(normalizedName, LINK);

					// Handle empty linkname.
					if (!linkname) return { outPath, type: "link" as const };

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

					// Ensure target's parent directory exists.
					await prepareDirectory(path.dirname(linkTarget));

					// Additionally validate by resolving target parents real path.
					const targetParent = path.dirname(linkTarget);
					const realTargetParent = await getRealDir(
						targetParent,
						`Hardlink "${linkname}" points outside the extraction directory.`,
					);
					const realLinkTarget = path.join(
						realTargetParent,
						path.basename(linkTarget),
					);

					validateBounds(
						realLinkTarget,
						destDir.real,
						`Hardlink "${linkname}" points outside the extraction directory.`,
					);

					// Defer hardlink creation until after all files are written.
					if (linkTarget !== outPath) {
						await prepareDirectory(parentDir);
						deferredLinks.push({ linkTarget, outPath });
					}

					return { outPath, type: "link" as const };
				}

				default:
					// Unknown entry type.
					return { outPath, type: "skip" as const };
			}
		},

		/**
		 * Creates all deferred hardlinks after file extraction is complete.
		 * This ensures hardlink targets exist before creating the links without race conditions.
		 */
		async applyLinks() {
			for (const { linkTarget, outPath } of deferredLinks) {
				try {
					await fs.link(linkTarget, outPath);
				} catch (err: unknown) {
					if ((err as NodeJS.ErrnoException).code === "ENOENT")
						throw new Error(
							`Hardlink target "${linkTarget}" does not exist for link at "${outPath}".`,
						);

					throw err;
				}
			}
		},
	};
};
