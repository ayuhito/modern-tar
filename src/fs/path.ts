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

// Validates that the given target path is within the destination directory and does not escape.
export function validateBounds(
	targetPath: string,
	destDir: string,
	errorMessage: string,
): void {
	const target = normalizeUnicode(path.resolve(targetPath));
	const dest = path.resolve(destDir);
	if (target !== dest && !target.startsWith(dest + path.sep))
		throw new Error(errorMessage);
}
