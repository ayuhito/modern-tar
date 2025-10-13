// Mapping of reserved characters to Unicode Private Use Area equivalents.
const REPLACEMENTS: Record<string, string> = {
	":": "\uF03A",
	"<": "\uF03C",
	">": "\uF03E",
	"|": "\uF07C",
	"?": "\uF03F",
	"*": "\uF02A",
	'"': "\uF022",
};

// Normalizes a tar entry path for safe extraction on Windows. This is a no-op on non-Windows platforms.
export function normalizeWindowsPath(p: string): string {
	if (!(process.platform === "win32")) return p;

	const normalized = p.replace(/\\/g, "/");

	// Reject Windows drive-letter traversal (e.g., "C:../").
	if (/^[A-Za-z]:\.\./i.test(normalized))
		throw new Error(`Entry ${p} points outside extraction directory.`);

	return (
		normalized
			// Strip drive-letter prefixes (e.g., "C:foo.txt" -> "foo.txt").
			// Only match single letter followed by colon.
			.replace(/^[A-Za-z]:/, "")
			// Encode reserved characters.
			.replace(/[<>:"|?*]/g, (char) => REPLACEMENTS[char])
	);
}
