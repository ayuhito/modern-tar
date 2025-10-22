import type { TarHeader, UnpackOptions } from "./types";

// Apply strip, filter, and map options to a header.
export function transformHeader(
	header: TarHeader,
	options: UnpackOptions,
): TarHeader | null {
	const { strip, filter, map } = options;
	if (!strip && !filter && !map) {
		return header;
	}

	// Shallow copy.
	const h = { ...header };

	// Strip path components.
	if (strip && strip > 0) {
		const components = h.name.split("/").filter(Boolean); // Filter empty strings.
		if (strip >= components.length) {
			return null; // Path is fully stripped
		}
		const newName = components.slice(strip).join("/");
		h.name =
			h.type === "directory" && !newName.endsWith("/")
				? `${newName}/`
				: newName;

		// Also strip absolute linknames.
		if (h.linkname?.startsWith("/")) {
			const linkComponents = h.linkname.split("/").filter(Boolean);
			h.linkname =
				strip >= linkComponents.length
					? "/" // Fully stripped, but retain root for absolute link.
					: `/${linkComponents.slice(strip).join("/")}`;
		}
	}

	if (filter?.(h) === false) {
		return null; // Skip filtered entry
	}

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
