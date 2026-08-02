export function* fragments(
	bytes: Uint8Array,
	size: number,
	start = 0,
): Iterable<Uint8Array> {
	if (size <= 0) throw new RangeError("Fragment size must be positive");

	for (let offset = start; offset < bytes.length; offset += size) {
		yield bytes.subarray(offset, offset + size);
	}
}
