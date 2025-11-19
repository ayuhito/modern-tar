import * as path from "node:path";
import { createCache } from "./cache";

const unicodeCache = createCache<string>();

// This implements a simple LRU cache for normalized non-ASCII strings.
export const normalizeUnicode = (s: string): string => {
	// Iterate through the string to check for non-ASCII characters.
	for (let i = 0; i < s.length; i++)
		// Only if a non-ASCII character is found, then we rely on caching.
		if (s.charCodeAt(i) >= 128) {
			const cached = unicodeCache.get(s);
			if (cached !== undefined) return cached;

			const normalized = s.normalize("NFD");
			unicodeCache.set(s, normalized);
			return normalized;
		}

	// Otherwise, fast path for ASCII-only strings.
	return s;
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

// Mapping reserved Windows characters to Unicode Private Use Area equivalents.
const win32Reserved: Record<string, string> = {
	":": "\uF03A",
	"<": "\uF03C",
	">": "\uF03E",
	"|": "\uF07C",
	"?": "\uF03F",
	"*": "\uF02A",
	'"': "\uF022",
};

// Normalizes a path for use as a tar entry name.
export function normalizeName(name: string): string {
	// Normalize backslashes to forward slashes.
	const path = name.replace(/\\/g, "/");

	if (
		// Reject ".." to prevent traversal.
		path.split("/").includes("..") ||
		// Windows drive-letter traversal (e.g., "C:../Windows")
		/^[a-zA-Z]:\.\./.test(path)
	)
		throw new Error(`${name} points outside extraction directory`);

	// Make the path relative by stripping absolute prefixes.
	let relative = path;
	if (/^[a-zA-Z]:/.test(relative)) {
		// Strip Windows drive letter (e.g., "C:", "C:/", "C:\")
		relative = relative.replace(/^[a-zA-Z]:[/\\]?/, "");
	} else if (relative.startsWith("/")) {
		// Strip all leading slashes for POSIX absolute paths (e.g., "/var/log/...", "//network/...")
		relative = relative.replace(/^\/+/, "");
	}

	// On Windows, encode reserved filesystem characters for safety.
	if (process.platform === "win32")
		return relative.replace(/[<>:"|?*]/g, (char) => win32Reserved[char]);

	return relative;
}

// Normalizes a header name by stripping trailing slashes and normalizing Unicode.
export const normalizeHeaderName = (s: string) =>
	// Strip trailing slashes.
	normalizeUnicode(normalizeName(s.replace(/\/+$/, "")));
