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
	encoder.encodeInto(octalString, view.subarray(offset, offset + size - 1));
}

/**
 * Reads a NUL-terminated string from the view.
 */
export function readString(
	view: Uint8Array,
	offset: number,
	size: number,
): string {
	// Find the first NUL byte within the specified size.
	const end = view.indexOf(0, offset);

	// If no NUL found, read the entire size.
	const sliceEnd = end === -1 || end > offset + size ? offset + size : end;
	return decoder.decode(view.subarray(offset, sliceEnd));
}

/**
 * Reads an octal number from the view.
 */
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
		value = (value << 3) + (charCode - 48); // 48 is ASCII '0'
	}

	return value;
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
	if (view[offset] & 0x80) {
		let result = 0;
		for (let i = 0; i < size; i++) {
			result = (result << 8) | view[offset + i];
		}
		return result & ~(0x80 << ((size - 1) * 8));
	}
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
