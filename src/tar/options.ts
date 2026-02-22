import { DIRECTORY, LINK } from "./constants";
import type { TarHeader, UnpackOptions } from "./types";

// Strip the first n components from a path.
const stripPath = (p: string, n: number): string => {
	const parts = p.split("/").filter(Boolean);
	return n >= parts.length ? "" : parts.slice(n).join("/");
};

// Apply strip, filter, and map options to a header.
export function transformHeader(
	header: TarHeader,
	options: UnpackOptions,
): TarHeader | null {
	const { strip, filter, map } = options;
	if (!strip && !filter && !map) return header;

	// Shallow copy.
	const h = { ...header };

	// Strip path components.
	if (strip && strip > 0) {
		const newName = stripPath(h.name, strip);
		if (!newName) return null; // Path is fully stripped

		h.name =
			h.type === DIRECTORY && !newName.endsWith("/") ? `${newName}/` : newName;

		// Strip linknames that are archive-root-relative.
		//
		// - Hardlink linknames are relative to the archive root, so they must be stripped.
		// - Symlink linknames are relative to the entry's parent directory, so only absolute symlinks need stripping.
		if (h.linkname) {
			const isAbsolute = h.linkname.startsWith("/");
			if (isAbsolute || h.type === LINK) {
				const stripped = stripPath(h.linkname, strip);
				h.linkname = isAbsolute ? `/${stripped}` || "/" : stripped;
			}
		}
	}

	if (filter?.(h) === false) return null; // Skip filtered entry

	const result = map ? map(h) : h;

	// Skip entries with empty names, whitespace only names, or paths that would resolve to extraction root.
	if (
		result &&
		(!result.name ||
			!result.name.trim() ||
			result.name === "." ||
			result.name === "/")
	) {
		return null;
	}

	return result;
}
