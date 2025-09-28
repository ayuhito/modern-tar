import type { Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const cache = new Map<string, string>();
const MAX_CACHE_SIZE = 10000;

// This implements a simple LRU cache for normalized strings.
export const normalizeUnicode = (s: string): string => {
	let result = cache.get(s);

	// On a cache hit, delete the entry so it can be re-added at the end.
	if (result !== undefined) cache.delete(s);

	result = result ?? s.normalize("NFD");
	cache.set(s, result);

	// Prune the cache if it's more than 10% over the max size.
	const overflow = cache.size - MAX_CACHE_SIZE;
	if (overflow > MAX_CACHE_SIZE / 10) {
		const keys = cache.keys();

		for (let i = 0; i < overflow; i++) {
			// biome-ignore lint/style/noNonNullAssertion: This is only triggered when keys exist.
			cache.delete(keys.next().value!);
		}
	}

	return result;
};

/**
 * Recursively validates that each item of the given path exists and is a directory or
 * a safe symlink.
 *
 * We need to call this for each path component to ensure that no symlinks escape the
 * target directory.
 */
export async function validatePath(
	currentPath: string,
	root: string,
	cache: Set<string>,
) {
	const normalizedPath = normalizeUnicode(currentPath);

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

// Validates that the given target path is within the destination directory and does not escape.
export function validateBounds(
	targetPath: string,
	destDir: string,
	errorMessage: string,
): void {
	const normalizedTarget = normalizeUnicode(targetPath);
	if (
		!(
			normalizedTarget === destDir ||
			normalizedTarget.startsWith(destDir + path.sep)
		)
	) {
		throw new Error(errorMessage);
	}
}
