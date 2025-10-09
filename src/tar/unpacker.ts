import { BLOCK_SIZE, BLOCK_SIZE_MASK } from "./constants";
import {
	applyOverrides,
	getMetaParser,
	type HeaderOverrides,
	type InternalTarHeader,
	parseUstarHeader,
} from "./header";
import type { DecoderOptions, TarHeader, UnpackHandler } from "./types";

// States for the unpacker state machine.
const STATE_HEADER = 0;
const STATE_BODY = 1;
const STATE_PADDING = 2;
const STATE_AWAIT_EOF = 3;

type State =
	| typeof STATE_HEADER
	| typeof STATE_BODY
	| typeof STATE_PADDING
	| typeof STATE_AWAIT_EOF;

interface ChunkNode {
	data: Uint8Array;
	consumed: number; // Bytes.
}

export function createTarUnpacker(
	handler: UnpackHandler,
	options: DecoderOptions = {},
) {
	const strict = options.strict ?? false;

	const chunkQueue: ChunkNode[] = [];
	let totalAvailable = 0;

	let state: State = STATE_HEADER;
	let waitingForData = false;

	let currentEntry: {
		remaining: number;
		padding: number;
	} | null = null;
	const paxGlobals: HeaderOverrides = {};
	let nextEntryOverrides: HeaderOverrides = {};

	// Consumes up to `size` bytes from the chunk queue. Optionally triggers a callback
	// with each consumed segment.
	function consume(
		size: number,
		callback?: (data: Uint8Array) => void,
	): number {
		let remaining = Math.min(size, totalAvailable);
		const initialRemaining = remaining;

		// Consume chunks in FIFO order.
		while (remaining > 0 && chunkQueue.length > 0) {
			const chunkNode = chunkQueue[0];
			const available = chunkNode.data.length - chunkNode.consumed;
			const toProcess = Math.min(remaining, available);

			// Callback with the segment if provided. Then update state.
			if (callback) {
				callback(
					chunkNode.data.subarray(
						chunkNode.consumed,
						chunkNode.consumed + toProcess,
					),
				);
			}

			chunkNode.consumed += toProcess;
			remaining -= toProcess;

			// Remove the chunk if fully consumed.
			if (chunkNode.consumed >= chunkNode.data.length) {
				chunkQueue.shift();
			}
		}

		totalAvailable -= initialRemaining - remaining;
		return initialRemaining - remaining;
	}

	// Reads data into a single buffer. This should be only used for small header/meta blocks.
	function read(size: number): Uint8Array | null {
		const toRead = Math.min(size, totalAvailable);
		if (toRead === 0) return null;

		// If the entire read fits in this chunk, slice and return it.
		const chunk = chunkQueue[0];
		if (chunk) {
			const dataLeft = chunk.data.length - chunk.consumed;

			if (dataLeft >= toRead) {
				const result = chunk.data.subarray(
					chunk.consumed,
					chunk.consumed + toRead,
				);

				chunk.consumed += toRead;
				totalAvailable -= toRead;

				// Remove the chunk if fully consumed.
				if (chunk.consumed >= chunk.data.length) {
					chunkQueue.shift();
				}

				return result;
			}
		}

		// Otherwise, we need to copy from multiple chunks.
		const result = new Uint8Array(toRead);
		let offset = 0;
		consume(toRead, (data) => {
			result.set(data, offset);
			offset += data.length;
		});

		return result;
	}

	// Main loop to process data.
	function process(): void {
		while (true) {
			switch (state) {
				case STATE_HEADER: {
					// Wait for more chunks.
					if (totalAvailable < BLOCK_SIZE) {
						waitingForData = true;
						return;
					}

					const headerBlock = read(BLOCK_SIZE);
					if (!headerBlock) {
						waitingForData = true;
						return;
					}

					if (isZeroBlock(headerBlock)) {
						state = STATE_AWAIT_EOF;
						continue;
					}

					// Parse the header.
					waitingForData = false;
					try {
						const internalHeader: InternalTarHeader = parseUstarHeader(
							headerBlock,
							strict,
						);
						const header: TarHeader = {
							...internalHeader,
							name: internalHeader.name,
						};

						// Handle special meta blocks (PAX/GNU) etc.
						const metaParser = getMetaParser(header.type);
						if (metaParser) {
							const paddedSize =
								(header.size + BLOCK_SIZE_MASK) & ~BLOCK_SIZE_MASK;

							// If we don't have enough, unshift the header back and wait.
							if (totalAvailable < paddedSize) {
								waitingForData = true;
								chunkQueue.unshift({ data: headerBlock, consumed: 0 });
								totalAvailable += BLOCK_SIZE;
								return;
							}

							const metaBlock = read(paddedSize);
							if (!metaBlock) {
								waitingForData = true;
								return;
							}

							// Parse and store the overrides.
							const overrides = metaParser(metaBlock.subarray(0, header.size));
							if (header.type === "pax-global-header") {
								Object.assign(paxGlobals, overrides);
							} else {
								Object.assign(nextEntryOverrides, overrides);
							}
							continue;
						}

						// Apply prefix and overrides if present.
						if (internalHeader.prefix)
							header.name = `${internalHeader.prefix}/${header.name}`;
						applyOverrides(header, paxGlobals);
						applyOverrides(header, nextEntryOverrides);
						nextEntryOverrides = {};

						// Trigger the header callback and move to next state.
						handler.onHeader(header);

						if (header.size > 0) {
							currentEntry = {
								remaining: header.size,
								padding: -header.size & BLOCK_SIZE_MASK,
							};

							state = STATE_BODY;
						} else {
							handler.onEndEntry();
						}
					} catch (error) {
						handler.onError(error as Error);
						return;
					}

					continue;
				}

				case STATE_BODY: {
					if (!currentEntry) throw new Error("No current entry for body");

					// Consume data for the current entry.
					const toForward = Math.min(currentEntry.remaining, totalAvailable);
					if (toForward > 0) {
						const consumed = consume(toForward, handler.onData);
						currentEntry.remaining -= consumed;
					}

					// If entry is fully read, move to padding or next header.
					if (currentEntry.remaining === 0) {
						state = currentEntry.padding > 0 ? STATE_PADDING : STATE_HEADER;
						if (state === STATE_HEADER) {
							handler.onEndEntry();
							currentEntry = null;
						}
					} else if (totalAvailable === 0) {
						waitingForData = true;
						return;
					}

					continue;
				}

				case STATE_PADDING:
					if (!currentEntry) throw new Error("No current entry for padding");

					if (totalAvailable < currentEntry.padding) {
						waitingForData = true;
						return;
					}

					// Consume padding and move to next header.
					if (currentEntry.padding > 0) {
						consume(currentEntry.padding);
					}

					handler.onEndEntry();
					currentEntry = null;
					state = STATE_HEADER;
					continue;

				case STATE_AWAIT_EOF: {
					if (totalAvailable < BLOCK_SIZE) {
						waitingForData = true;
						return;
					}

					// Expecting a second zero block for valid EOF.
					const secondBlock = read(BLOCK_SIZE);
					if (!secondBlock) {
						waitingForData = true;
						return;
					}

					if (isZeroBlock(secondBlock)) {
						// Valid EOF found, stop processing.
						return;
					}

					if (strict) {
						handler.onError(new Error("Invalid EOF"));
						return;
					}

					// Not a real EOF, treat the second block as a header.
					chunkQueue.unshift({ data: secondBlock, consumed: 0 });
					totalAvailable += BLOCK_SIZE;
					state = STATE_HEADER;
					continue;
				}

				default:
					throw new Error("Invalid state in tar unpacker.");
			}
		}
	}

	return {
		write(chunk: Uint8Array): void {
			if (chunk.length === 0) return;

			// Append the chunk to the queue.
			chunkQueue.push({ data: chunk, consumed: 0 });
			totalAvailable += chunk.length;

			if (waitingForData) {
				waitingForData = false;
				try {
					process();
				} catch (error) {
					handler.onError(error as Error);
				}
			}
		},

		end(): void {
			try {
				if (!waitingForData) process();

				if (strict) {
					if (currentEntry && currentEntry.remaining > 0) {
						const error = new Error("Tar archive is truncated.");
						handler.onError(error);
						throw error;
					}

					if (totalAvailable > 0) {
						const remainingData = read(totalAvailable);
						if (remainingData?.some((b) => b !== 0)) {
							const error = new Error("Invalid EOF.");
							handler.onError(error);
							throw error;
						}
					}

					if (waitingForData) {
						const error = new Error("Tar archive is truncated.");
						handler.onError(error);
						throw error;
					}
				} else {
					if (currentEntry) {
						handler.onEndEntry();
						currentEntry = null;
					}
				}
			} catch (error) {
				handler.onError(error as Error);
			}
		},
	};
}

// Instead of checking each byte individually (512 iterations), we can check
// 8 bytes at a time using BigUint64Array (64 iterations).
function isZeroBlock(block: Uint8Array): boolean {
	// If the block's offset within its underlying buffer is 8-byte aligned, we can safely
	// use BigUint64Array for a fast path check.
	if (block.byteOffset % 8 === 0) {
		const view = new BigUint64Array(
			block.buffer,
			block.byteOffset,
			block.length / 8,
		);

		for (let i = 0; i < view.length; i++) {
			if (view[i] !== 0n) return false;
		}

		return true;
	}

	// If the block is not 8-byte aligned, creating a BigUint64Array would throw, so fallback
	// to counting every byte.
	for (let i = 0; i < block.length; i++) {
		if (block[i] !== 0) return false;
	}

	return true;
}
