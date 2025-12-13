import { createChunkQueue } from "./chunk-queue";
import { BLOCK_SIZE, BLOCK_SIZE_MASK } from "./constants";
import {
	applyOverrides,
	getMetaParser,
	type HeaderOverrides,
	type InternalTarHeader,
	parseUstarHeader,
} from "./header";
import type { DecoderOptions, TarHeader } from "./types";

// States for the unpacker state machine.
const STATE_HEADER = 0;
const STATE_BODY = 1;

const truncateErr = new Error("Tar archive is truncated.");

export function createUnpacker(options: DecoderOptions = {}) {
	const strict = options.strict ?? false;
	const { available, peek, push, discard, pull } = createChunkQueue();

	let state: 0 | 1 = STATE_HEADER;
	let ended = false;
	let done = false;
	let eof = false;

	let currentEntry: {
		header: TarHeader;
		remaining: number;
		padding: number;
	} | null = null;

	const paxGlobals: HeaderOverrides = {};
	let nextEntryOverrides: HeaderOverrides = {};

	const unpacker = {
		isEntryActive: (): boolean => state === STATE_BODY,

		/** Checks if the body of the current entry has been fully consumed. */
		isBodyComplete: (): boolean =>
			!currentEntry || currentEntry.remaining === 0,

		/** Add data to the internal buffer. */
		write(chunk: Uint8Array): void {
			if (ended) throw new Error("Archive already ended.");
			push(chunk);
		},

		/** Signal that no more data will be written. */
		end(): void {
			ended = true;
		},

		/**
		 * Tries to read and parse the next header from the queue.
		 * Returns a TarHeader if successful, null if more data is needed,
		 * or undefined if the stream has ended.
		 */
		readHeader(): TarHeader | null | undefined {
			if (state !== STATE_HEADER)
				throw new Error("Cannot read header while an entry is active");
			if (done) return undefined;

			while (!done) {
				// Check if we have enough data for at least one header.
				if (available() < BLOCK_SIZE) {
					// If the stream has ended, any remaining data indicates a truncated archive.
					if (ended) {
						if (available() > 0 && strict) throw truncateErr;

						done = true;
						return undefined;
					}

					return null;
				}

				// Peek at the next block since we know it is not null from above.
				const headerBlock = peek(BLOCK_SIZE) as Uint8Array;

				if (isZeroBlock(headerBlock)) {
					// We need to check for a second zero block to confirm a valid EOF.
					if (available() < BLOCK_SIZE * 2) {
						// Not enough data to check for the second block.
						if (ended) {
							if (strict) throw truncateErr;
							done = true;
							return undefined;
						}

						return null; // Wait for more data.
					}

					// Check if the second block is also zeroed.
					const eofBlock = peek(BLOCK_SIZE * 2) as Uint8Array;
					if (isZeroBlock(eofBlock.subarray(BLOCK_SIZE))) {
						discard(BLOCK_SIZE * 2); // Valid EOF.
						done = true;
						eof = true;
						return undefined;
					}

					if (strict) throw new Error("Invalid tar header.");
					discard(BLOCK_SIZE); // Skip single zero block.
					continue;
				}

				// It's not a zero block, so try to parse it as a header.
				let internalHeader: InternalTarHeader;
				try {
					internalHeader = parseUstarHeader(headerBlock, strict);
				} catch (err) {
					if (strict) throw err;
					// In non-strict mode, just consume the invalid block and continue.
					discard(BLOCK_SIZE);
					continue;
				}

				// Check if it's a meta-header (like PAX or GNU long names).
				const metaParser = getMetaParser(internalHeader.type);
				if (metaParser) {
					const paddedSize =
						(internalHeader.size + BLOCK_SIZE_MASK) & ~BLOCK_SIZE_MASK;

					// Check if we have enough data for the meta entry's body using total size.
					if (available() < BLOCK_SIZE + paddedSize) {
						if (ended && strict) throw truncateErr;
						return null;
					}

					// Consume the meta header and its body, then apply the metadata.
					discard(BLOCK_SIZE);
					const metaBlock = pull(paddedSize) as Uint8Array;
					const overrides = metaParser(
						metaBlock.subarray(0, internalHeader.size),
					);

					// Store the overrides for the next entry or globally for PAX global headers.
					const target =
						internalHeader.type === "pax-global-header"
							? paxGlobals
							: nextEntryOverrides;

					for (const key in overrides) target[key] = overrides[key];

					continue;
				}

				discard(BLOCK_SIZE);

				// Apply prefixes from USTAR and any overrides from meta-headers.
				const header: TarHeader = internalHeader;
				if (internalHeader.prefix)
					header.name = `${internalHeader.prefix}/${header.name}`;

				applyOverrides(header, paxGlobals);
				applyOverrides(header, nextEntryOverrides);
				nextEntryOverrides = {}; // Reset for the next entry.

				// Set up state for body processing.
				currentEntry = {
					header,
					remaining: header.size,
					padding: -header.size & BLOCK_SIZE_MASK,
				};

				state = STATE_BODY;
				return header;
			}
		},

		/** Streams the body of the current entry to a callback. */
		streamBody(callback: (chunk: Uint8Array) => boolean): number {
			if (state !== STATE_BODY || !currentEntry || currentEntry.remaining === 0)
				return 0;

			const bytesToFeed = Math.min(currentEntry.remaining, available());
			if (bytesToFeed === 0) return 0;

			const fed = pull(bytesToFeed, callback);
			currentEntry.remaining -= fed;
			return fed;
		},

		/**
		 * Skips the remaining padding for the current entry.
		 * Returns true if padding was fully skipped, false if more data is needed.
		 */
		skipPadding(): boolean {
			if (state !== STATE_BODY || !currentEntry) return true;

			if (currentEntry.remaining > 0)
				throw new Error("Body not fully consumed");

			// Not enough data for padding.
			if (available() < currentEntry.padding) return false;

			// Consume the padding.
			discard(currentEntry.padding);

			currentEntry = null;
			state = STATE_HEADER;
			return true;
		},

		/**
		 * Discards the current entry's body and its padding.
		 *
		 * Returns true when the full entry has been skipped, false if more
		 * data is required.
		 */
		skipEntry(): boolean {
			if (state !== STATE_BODY || !currentEntry) return true;

			const toDiscard = Math.min(currentEntry.remaining, available());
			if (toDiscard > 0) {
				discard(toDiscard);
				currentEntry.remaining -= toDiscard;
			}

			if (currentEntry.remaining > 0) return false;
			return unpacker.skipPadding();
		},

		validateEOF() {
			if (strict) {
				if (!eof) throw truncateErr;
				if (available() > 0) {
					const remaining = pull(available()) as Uint8Array;
					if (remaining.some((byte) => byte !== 0))
						throw new Error("Invalid EOF.");
				}
			}
		},
	};

	return unpacker;
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
