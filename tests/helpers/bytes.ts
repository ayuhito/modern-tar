export function* chunkBytes(
	bytes: Uint8Array,
	size: number,
	startOffset = 0,
): Iterable<Uint8Array> {
	if (size <= 0) throw new RangeError("Fragment size must be positive");

	for (let offset = startOffset; offset < bytes.length; offset += size) {
		yield bytes.subarray(offset, offset + size);
	}
}
