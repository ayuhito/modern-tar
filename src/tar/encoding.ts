export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

// Writes a string to the view, truncating if necessary.
// Assumes the view is zero-filled, so any remaining space is null-padded.
export function writeString(
	view: Uint8Array,
	offset: number,
	size: number,
	value?: string,
) {
	if (!value) return;

	// Copy ASCII directly, but leave Unicode truncation to TextEncoder.
	for (let i = 0; i < value.length && i < size; i++) {
		const charCode = value.charCodeAt(i);
		if (charCode > 0x7f) {
			encoder.encodeInto(value, view.subarray(offset, offset + size));
			return;
		}
		view[offset + i] = charCode;
	}
}

// Writes a number as a zero-padded octal string.
export function writeOctal(
	view: Uint8Array,
	offset: number,
	size: number,
	value?: number,
) {
	if (value === undefined) return;
	if (!Number.isSafeInteger(value) || value < 0)
		throw new Error(`Invalid tar number: ${value}`);

	// PAX carries the actual value when the USTAR field overflows.
	let remaining = value >= 8 ** (size - 1) ? 0 : value;

	// TAR numeric fields are zero-padded ASCII octal with a final NUL byte. As an
	// optimization, fill digits right-to-left instead of encoding a padded string.
	for (let i = offset + size - 2; i >= offset; i--) {
		view[i] = 48 + (remaining & 7); // 48 is ASCII '0'.
		// A shift would discard the high bits of values wider than 32 bits.
		remaining = Math.floor(remaining / 8);
	}
}

// Reads a NUL-terminated string from the view.
export function readString(
	view: Uint8Array,
	offset: number,
	size: number,
): string {
	if (view[offset] === 0) return "";

	// Find the first NUL byte within the specified size.
	const end = view.indexOf(0, offset);

	// If no NUL found, read the entire size.
	const sliceEnd = end === -1 || end > offset + size ? offset + size : end;
	return decoder.decode(view.subarray(offset, sliceEnd));
}

// Reads an octal number from the view.
export function readOctal(
	view: Uint8Array,
	offset: number,
	size: number,
): number {
	let value = 0;
	const end = offset + size;

	for (let i = offset; i < end; i++) {
		const charCode = view[i];
		if (charCode === 0) break; // Stop at NUL terminator
		if (charCode === 32) continue; // Ignore whitespace
		if (charCode < 48 || charCode > 55) throw new Error("Invalid tar number.");
		value = value * 8 + (charCode - 48); // 48 is ASCII '0'
	}

	return value;
}

// Reads an octal or GNU base-256 numeric field.
export function readNumeric(
	view: Uint8Array,
	offset: number,
	size: number,
): number {
	const first = view[offset];
	if (first === 0x80 || first === 0xff) {
		// GNU uses 0x80 for nonnegative values and 0xff for negative values.
		// Start at -1 to sign-extend a negative field as we read its bytes.
		let result = first === 0xff ? -1 : 0;

		for (let i = 1; i < size; i++) {
			result = result * 256 + view[offset + i];
		}

		if (!Number.isSafeInteger(result)) throw new Error("TAR number too large");

		return result;
	}

	return readOctal(view, offset, size);
}
