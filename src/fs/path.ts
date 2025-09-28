import type { Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const unicodeCache = new Map<string, string>();
const MAX_CACHE_SIZE = 10000;

// This implements a simple LRU cache for normalized strings.
export const normalizeUnicode = (s: string): string => {
	let result = unicodeCache.get(s);

	// On a cache hit, delete the entry so it can be re-added at the end.
	if (result !== undefined) unicodeCache.delete(s);

	result = result ?? s.normalize("NFD");
	unicodeCache.set(s, result);

	// Prune the cache if it's more than 10% over the max size.
	const overflow = unicodeCache.size - MAX_CACHE_SIZE;
	if (overflow > MAX_CACHE_SIZE / 10) {
		const keys = unicodeCache.keys();

		for (let i = 0; i < overflow; i++) {
			// biome-ignore lint/style/noNonNullAssertion: This is only triggered when keys exist.
			unicodeCache.delete(keys.next().value!);
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

	// We only need to check the part of the path relative to the root,
	const relativePath = path.relative(root, normalizedPath);

	// Don't process empty strings or other edge cases from relative.
	if (!relativePath) {
		return;
	}

	const components = relativePath.split(path.sep);
	let current = root;

	for (const component of components) {
		// On Windows, 'C:' can be a component. join handles this.
		current = path.join(current, component);

		if (cache.has(current)) {
			continue;
		}

		let stat: Stats;
		try {
			stat = await fs.lstat(current);
		} catch (err) {
			if (
				err instanceof Error &&
				"code" in err &&
				(err.code === "ENOENT" || err.code === "EPERM")
			) {
				cache.add(current);
				continue;
			}

			throw err;
		}

		if (stat.isDirectory()) {
			cache.add(current);
			continue;
		}

		if (stat.isSymbolicLink()) {
			const realPath = await fs.realpath(current);
			validateBounds(
				realPath,
				root,
				`Path traversal attempt detected: symlink "${current}" points outside the extraction directory.`,
			);

			cache.add(current);
			continue;
		}

		throw new Error(
			`Path traversal attempt detected: "${current}" is not a valid directory component.`,
		);
	}
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
