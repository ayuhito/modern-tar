import * as path from "node:path";

// Validates that the given target path is within the destination directory and does not escape.
export function validateBounds(
	targetPath: string,
	destDir: string,
	errorMessage: string,
): void {
	const target = path.resolve(targetPath);
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

// Normalizes a header name without changing its Unicode spelling.
export const normalizeHeaderName = (s: string) =>
	// Strip trailing slashes.
	normalizeName(s.replace(/\/+$/, ""));
