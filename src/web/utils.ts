export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

/**
 * Writes a string to the view, truncating if necessary.
 * Assumes the view is zero-filled, so any remaining space is null-padded.
 */
export function writeString(
	view: Uint8Array,
	offset: number,
	size: number,
	value?: string,
) {
	if (value) {
		encoder.encodeInto(value, view.subarray(offset, offset + size));
	}
}

/**
 * Writes a number as a zero-padded octal string.
 */
export function writeOctal(
	view: Uint8Array,
	offset: number,
	size: number,
	value?: number,
) {
	if (value === undefined) return;

	// Format to an octal string, pad with leading zeros to size - 1.
	// The final byte is left as 0 (NUL terminator), assuming a zero-filled view.
	const octalString = value.toString(8).padStart(size - 1, "0");
	writeString(view, offset, size - 1, octalString);
}

/**
 * Reads a NUL-terminated string from the view.
 */
export function readString(
	view: Uint8Array,
	offset: number,
	size: number,
): string {
	const slice = view.subarray(offset, offset + size);
	const nullIndex = slice.indexOf(0);

	// Decode up to the first NUL char, or the full slice if no NUL is found.
	const effectiveSlice =
		nullIndex === -1 ? slice : slice.subarray(0, nullIndex);

	return decoder.decode(effectiveSlice);
}

/**
 * Reads an octal number from the view.
 */
export function readOctal(
	view: Uint8Array,
	offset: number,
	size: number,
): number {
	const octalString = readString(view, offset, size).trim();

	// An empty or invalid octal string is treated as zero.
	return octalString ? Number.parseInt(octalString, 8) : 0;
}
