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
	return octalString ? parseInt(octalString, 8) : 0;
}

/**
 * Reads a numeric field that can be octal or POSIX base-256.
 * This implementation handles positive integers, such as uid, gid, and size.
 */
export function readNumeric(
	view: Uint8Array,
	offset: number,
	size: number,
): number {
	// POSIX base-256 encoding uses the high bit of the first byte to indicate
	// that the field is in base-256.
	if (view[offset] & 0x80) {
		let result = view[offset] & 0x7f; // Handle the first byte separately, clearing the high bit.

		// Start loop from the second byte.
		for (let i = 1; i < size; i++) {
			// (result << 8) is equivalent to (result * 256) but faster.
			// | view[offset + i] is equivalent to + view[offset + i] for positive numbers.
			result = (result << 8) | view[offset + i];
		}

		return result;
	}

	// Fallback to standard octal parsing.
	return readOctal(view, offset, size);
}

/**
 * Reads an entire ReadableStream of Uint8Arrays into a single, combined Uint8Array.
 *
 * The easy way to do this is `new Response(stream).arrayBuffer()`, but we can be more
 * performant by buffering the chunks directly.
 */
export async function streamToBuffer(
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	const reader = stream.getReader();
	let totalLength = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			chunks.push(value);
			totalLength += value.length;
		}

		// Pre-allocate the final buffer.
		const result = new Uint8Array(totalLength);
		let offset = 0;

		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.length;
		}

		return result;
	} finally {
		reader.releaseLock();
	}
}
