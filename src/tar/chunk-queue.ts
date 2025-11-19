import { EMPTY } from "./constants";

interface ChunkQueue {
	push(chunk: Uint8Array): void;
	available(): number;
	peek(bytes: number): Readonly<Uint8Array> | null;
	discard(bytes: number): void;
	pull(bytes: number): Uint8Array | null;
	pull(bytes: number, callback: (chunk: Uint8Array) => boolean): number;
}

const INITIAL_CAPACITY = 256;

/**
 * Creates a circular buffer for streaming TAR archive parsing.
 *
 * This queue manages pulls and pushes Uint8Array chunks from the unpacker stream with
 * specific sizes in mind (like 512-byte headers and file data). It automatically grows
 * if needed and returns zero copy views if possible.
 */
export function createChunkQueue(): ChunkQueue {
	// - 8 bytes chunk reference
	// = 256 * 8 = 2kb initial memory overhead
	let chunks = new Array<Uint8Array>(INITIAL_CAPACITY);
	// Each slot stores the remaining portion of a chunk, so offsets are implicit.
	let capacityMask = chunks.length - 1; // For bitwise wrapping (length is power of 2).

	let head = 0;
	let tail = 0;
	let totalAvailable = 0;

	// Consumes `count` bytes from the head chunks.
	const consumeFromHead = (count: number): void => {
		const chunk = chunks[head];
		if (count === chunk.length) {
			chunks[head] = EMPTY;
			head = (head + 1) & capacityMask; // Wrap to start if at end.
		} else {
			// Preserve remainder with view.
			chunks[head] = chunk.subarray(count);
		}

		totalAvailable -= count;

		// Forcefully resetting lets the GC reclaim memory for large queues.
		if (totalAvailable === 0 && chunks.length > INITIAL_CAPACITY) {
			chunks = new Array<Uint8Array>(INITIAL_CAPACITY);
			capacityMask = INITIAL_CAPACITY - 1;
			head = 0;
			tail = 0;
		}
	};

	/**
	 * Read a specific number of bytes into a readable buffer.
	 *
	 * @returns `null` if not enough data is available.
	 * @returns `Uint8Array` of the requested size otherwise.
	 * @returns Number of bytes fed if a callback is provided.
	 */
	function pull(bytes: number): Uint8Array | null;
	function pull(
		bytes: number,
		callback: (chunk: Uint8Array) => boolean,
	): number;
	function pull(
		bytes: number,
		callback?: (chunk: Uint8Array) => boolean,
	): Uint8Array | number | null {
		if (callback) {
			let fed = 0;
			let remaining = Math.min(bytes, totalAvailable);

			// Feed bytes across chunks.
			while (remaining > 0) {
				const chunk = chunks[head];
				const toFeed = Math.min(remaining, chunk.length);
				const segment =
					toFeed === chunk.length ? chunk : chunk.subarray(0, toFeed);

				// Consume the bytes from the queue.
				consumeFromHead(toFeed);
				remaining -= toFeed;
				fed += toFeed;

				// If the callback returns false, stop feeding more chunks.
				if (!callback(segment)) break;
			}

			return fed;
		}

		if (totalAvailable < bytes) return null;
		if (bytes === 0) return EMPTY;

		// If entire pull fits within the first chunk, return a view.
		const firstChunk = chunks[head];
		if (firstChunk.length >= bytes) {
			const view =
				firstChunk.length === bytes
					? firstChunk
					: firstChunk.subarray(0, bytes);

			consumeFromHead(bytes);
			return view;
		}

		// Otherwise, gather data across multiple chunks with a copy.
		const result = new Uint8Array(bytes);
		let copied = 0;
		let remaining = bytes;

		while (remaining > 0) {
			const chunk = chunks[head];
			const toCopy = Math.min(remaining, chunk.length);

			result.set(
				toCopy === chunk.length ? chunk : chunk.subarray(0, toCopy),
				copied,
			);
			copied += toCopy;
			remaining -= toCopy;
			consumeFromHead(toCopy);
		}

		return result;
	}

	return {
		/** Adds a new chunk to the end of the queue. */
		push: (chunk: Uint8Array): void => {
			if (chunk.length === 0) return;

			// If the circular buffer is full, double its size.
			let nextTail = (tail + 1) & capacityMask; // Check if next position wraps to head.
			if (nextTail === head) {
				const oldLen = chunks.length;
				const newLen = oldLen * 2;
				const newChunks = new Array<Uint8Array>(newLen);

				// Copy existing chunks to the new, larger arrays in correct order.
				const count = (tail - head + oldLen) & (oldLen - 1);

				// Copy from head to tail in order.
				if (head < tail) {
					for (let i = 0; i < count; i++) newChunks[i] = chunks[head + i];
				} else if (count > 0) {
					// Otherwise, we have wrapped data and need two copies.
					const firstPart = oldLen - head;
					for (let i = 0; i < firstPart; i++) newChunks[i] = chunks[head + i];
					for (let i = 0; i < tail; i++) newChunks[firstPart + i] = chunks[i];
				}

				// Update references to the new array and reset head/tail.
				chunks = newChunks;
				capacityMask = newLen - 1; // Update mask for new power-of-2 size
				head = 0;
				tail = count;
				nextTail = (tail + 1) & capacityMask;
			}

			// Add the new chunk to the tail of the circular buffer.
			chunks[tail] = chunk;
			tail = nextTail;
			totalAvailable += chunk.length;
		},

		/** Get total bytes available across all chunks */
		available: (): number => totalAvailable,

		/** Looks at the next `bytes` of data without consuming them. */
		peek: (bytes: number): Readonly<Uint8Array> | null => {
			if (totalAvailable < bytes) return null;
			if (bytes === 0) return EMPTY;

			const firstChunk = chunks[head];

			// If entire peek fits within the first chunk, return a view.
			if (firstChunk.length >= bytes) {
				// Returning a view avoids copying when the request stays within head.
				return firstChunk.length === bytes
					? firstChunk
					: firstChunk.subarray(0, bytes);
			}

			// Otherwise, gather data across multiple chunks.
			const result = new Uint8Array(bytes);

			let copied = 0;
			let index = head;

			while (copied < bytes) {
				const chunk = chunks[index];
				const toCopy = Math.min(bytes - copied, chunk.length);

				if (toCopy === chunk.length) {
					result.set(chunk, copied);
				} else {
					// Partial copy from this chunk.
					result.set(chunk.subarray(0, toCopy), copied);
				}

				copied += toCopy;
				index = (index + 1) & capacityMask; // Move to next chunk, wrapping around
			}

			return result;
		},

		/** Consumes `bytes` from the front of the queue. */
		discard: (bytes: number): void => {
			if (bytes > totalAvailable) throw new Error("Too many bytes consumed");
			if (bytes === 0) return;

			let remaining = bytes;

			// Consume bytes across chunks.
			while (remaining > 0) {
				const chunk = chunks[head];
				const toConsume = Math.min(remaining, chunk.length);

				consumeFromHead(toConsume);
				remaining -= toConsume;
			}
		},

		pull,
	};
}
