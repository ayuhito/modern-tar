import * as path from "node:path";
import { normalizeWindowsPath } from "./win-path";

const unicodeCache = new Map<string, string>();

// This implements a simple LRU cache for normalized strings.
export const normalizeUnicode = (s: string): string => {
	let result = unicodeCache.get(s);

	// On a cache hit, delete the entry so it can be re-added at the end.
	if (result !== undefined) unicodeCache.delete(s);

	result = result ?? s.normalize("NFD");
	unicodeCache.set(s, result);

	// Delete the oldest entry if we exceed the max size.
	if (unicodeCache.size > 10000) {
		// biome-ignore lint/style/noNonNullAssertion: At minimum one entry exists here.
		unicodeCache.delete(unicodeCache.keys().next().value!);
	}

	return result;
};

// Strips trailing slashes from a path.
export function stripTrailingSlashes(p: string): string {
	let i = p.length - 1;
	if (i === -1 || p[i] !== "/") {
		return p;
	}

	let slashesStart = i;
	while (i > -1 && p[i] === "/") {
		slashesStart = i;
		i--;
	}

	return p.slice(0, slashesStart);
}

export const normalizeHeaderName = (s: string) =>
	normalizeUnicode(normalizeWindowsPath(stripTrailingSlashes(s)));

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
