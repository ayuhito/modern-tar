import { validateChecksum } from "./checksum";
import {
	BLOCK_SIZE,
	BLOCK_SIZE_MASK,
	FLAGTYPE,
	USTAR_CHECKSUM_OFFSET,
	USTAR_CHECKSUM_SIZE,
	USTAR_GID_OFFSET,
	USTAR_GID_SIZE,
	USTAR_GNAME_OFFSET,
	USTAR_GNAME_SIZE,
	USTAR_LINKNAME_OFFSET,
	USTAR_LINKNAME_SIZE,
	USTAR_MAGIC_OFFSET,
	USTAR_MAGIC_SIZE,
	USTAR_MODE_OFFSET,
	USTAR_MODE_SIZE,
	USTAR_MTIME_OFFSET,
	USTAR_MTIME_SIZE,
	USTAR_NAME_OFFSET,
	USTAR_NAME_SIZE,
	USTAR_PREFIX_OFFSET,
	USTAR_PREFIX_SIZE,
	USTAR_SIZE_OFFSET,
	USTAR_SIZE_SIZE,
	USTAR_TYPEFLAG_OFFSET,
	USTAR_TYPEFLAG_SIZE,
	USTAR_UID_OFFSET,
	USTAR_UID_SIZE,
	USTAR_UNAME_OFFSET,
	USTAR_UNAME_SIZE,
} from "./constants";
import type { DecoderOptions, ParsedTarEntry, TarHeader } from "./types";
import { decoder, readNumeric, readOctal, readString } from "./utils";

interface InternalTarHeader extends TarHeader {
	checksum: number;
	magic: string;
	prefix: string;
}

type HeaderOverrides = Omit<Partial<TarHeader>, "mtime"> & {
	// PAX mtime is a float, handle it as a number before converting to Date
	mtime?: number;
};

/**
 * Create a transform stream that parses tar bytes into entries.
 *
 * @param options - Optional configuration for the decoder using {@link DecoderOptions}.
 * @returns `TransformStream` that converts tar archive bytes to {@link ParsedTarEntry} objects.
 * @example
 * ```typescript
 * import { createTarDecoder } from 'modern-tar';
 *
 * const decoder = createTarDecoder();
 * const entriesStream = tarStream.pipeThrough(decoder);
 *
 * for await (const entry of entriesStream) {
 *  console.log(`Entry: ${entry.header.name}`);
 *  // Process entry.body stream as needed
 * }
 */
export function createTarDecoder(
	options: DecoderOptions = {},
): TransformStream<Uint8Array, ParsedTarEntry> {
	const strict = options.strict ?? false;

	// Chunk queue
	const chunks: Uint8Array[] = [];
	let totalLength = 0;
	let offset = 0; // Read offset within the first chunk only

	// State for entries
	let currentEntry: {
		header: TarHeader;
		bytesLeft: number;
		controller: ReadableStreamDefaultController<Uint8Array>;
	} | null = null;
	let paxGlobals: HeaderOverrides = {};
	let nextEntryOverrides: HeaderOverrides = {};

	/**
	 * Reads and consumes a specific number of bytes from the chunk queue.
	 * Returns a single Uint8Array with the data, or null if not enough data is available.
	 */
	function consume(size: number): Uint8Array | null {
		if (totalLength < size || chunks.length === 0) {
			return null;
		}

		totalLength -= size;

		const firstChunk = chunks[0];

		// Fast path: The entire data block is within the first chunk.
		if (firstChunk.length - offset >= size) {
			const data = firstChunk.slice(offset, offset + size);
			offset += size;

			// If we've consumed the entire chunk, remove it and reset offset.
			if (offset === firstChunk.length) {
				chunks.shift();
				offset = 0;
			}

			return data;
		}

		// Slow path: The data spans multiple chunks, so we need to stitch them together to reach the needed size.
		const data = new Uint8Array(size);
		let bytesCopied = 0;

		while (bytesCopied < size) {
			const chunk = chunks[0];
			// Compare with remaining bytes needed and remaining bytes in chunk.
			const bytesToCopy = Math.min(size - bytesCopied, chunk.length - offset);

			// Copy the data from the current chunk to the result buffer.
			data.set(chunk.subarray(offset, offset + bytesToCopy), bytesCopied);
			bytesCopied += bytesToCopy;
			offset += bytesToCopy;

			if (offset === chunk.length) {
				chunks.shift();
				offset = 0;
			}
		}

		return data;
	}

	/**
	 * Forwards a specific number of bytes from the chunk queue directly to a stream controller.
	 * This avoids creating a new intermediate buffer for the entire file body.
	 * Returns the number of bytes actually forwarded.
	 */
	function forward(
		size: number,
		targetController: ReadableStreamDefaultController<Uint8Array>,
	): number {
		const bytesToForward = Math.min(size, totalLength);
		let forwarded = 0;

		while (forwarded < bytesToForward && chunks.length > 0) {
			const firstChunk = chunks[0];
			const availableInChunk = firstChunk.length - offset;
			const bytesToSend = Math.min(
				bytesToForward - forwarded,
				availableInChunk,
			);

			targetController.enqueue(
				firstChunk.subarray(offset, offset + bytesToSend),
			);
			forwarded += bytesToSend;
			offset += bytesToSend;

			// If we've consumed the entire chunk, remove it and reset offset
			if (offset === firstChunk.length) {
				chunks.shift();
				offset = 0;
			}
		}

		totalLength -= forwarded;
		return forwarded;
	}

	/**
	 * Un-consume data by putting it back at the front of the chunk queue.
	 * Used for lookahead operations that need to "peek" at data.
	 */
	function unshift(data: Uint8Array): void {
		if (offset > 0) {
			// If we were in the middle of a chunk, we need to put the remainder back as a full chunk
			chunks[0] = chunks[0].subarray(offset);
			offset = 0;
		}
		chunks.unshift(data);
		totalLength += data.length;
	}

	return new TransformStream({
		transform(chunk, controller) {
			// Just add the new chunk to the queue. No copying!
			chunks.push(chunk);
			totalLength += chunk.length;

			while (true) {
				// Read an entry's body.
				if (currentEntry) {
					const forwarded = forward(
						currentEntry.bytesLeft,
						currentEntry.controller,
					);
					currentEntry.bytesLeft -= forwarded;

					// If entry is complete, close its body stream and skip padding.
					if (currentEntry.bytesLeft === 0) {
						const padding = -currentEntry.header.size & BLOCK_SIZE_MASK;

						// consume() and discard the result to skip padding
						if (consume(padding) === null) {
							// Not enough data for padding, break and wait for more.
							break;
						}

						try {
							currentEntry.controller.close();
						} catch {
							// Suppress errors if stream is already closed.
						}
						currentEntry = null;
					} else {
						// Body is not fully read, and we've run out of data in this chunk.
						break;
					}
				}

				// Read the next header block.
				const headerBlock = consume(BLOCK_SIZE);
				if (headerBlock === null) {
					break; // Not enough data for a header.
				}

				// Check for two consecutive zero blocks indicating end of archive.
				if (headerBlock.every((b) => b === 0)) {
					const nextBlock = consume(BLOCK_SIZE);
					if (nextBlock === null) {
						// Not enough data for the second block, put the first block back and wait
						unshift(headerBlock);
						break;
					}

					if (nextBlock.every((b) => b === 0)) {
						controller.terminate();
						return;
					} else {
						// The second block was not all zeroes, so it's not actually the end of the archive
						// and we need to unconsume both blocks and continue processing.
						unshift(nextBlock);
						unshift(headerBlock);
					}
				}

				// First parse USTAR headers as a base. Extension headers will override this as needed.
				const header = parseUstarHeader(headerBlock, strict);

				// Check if the entry is a meta-entry (PAX, GNU, etc.)
				const metaParser = getMetaParser(header.type);
				if (metaParser) {
					const dataSize = header.size;
					const dataBlocksSize = (dataSize + BLOCK_SIZE_MASK) & -BLOCK_SIZE; // Padded to block size.

					if (totalLength < dataBlocksSize) {
						// Not enough data for the meta content, put header back.
						unshift(headerBlock);
						break;
					}

					const data = consume(dataSize);
					if (data === null) {
						// Not enough data for the meta content, put header back.
						unshift(headerBlock);
						break;
					}

					// Skip padding after data
					const padding = dataBlocksSize - dataSize;
					if (padding > 0) {
						const paddingData = consume(padding);
						if (paddingData === null) {
							// Not enough data for padding, put everything back.
							unshift(data);
							unshift(headerBlock);
							break;
						}
					}

					const overrides = metaParser(data);
					if (header.type === "pax-global-header") {
						paxGlobals = Object.assign({}, paxGlobals, overrides);
					} else {
						// gnu-long-name, gnu-long-link-name, and pax-header all apply to the next entry
						nextEntryOverrides = Object.assign(
							{},
							nextEntryOverrides,
							overrides,
						);
					}

					continue; // Move to the next header.
				}

				// If we reach here, it is a regular entry.
				const finalHeader: TarHeader = header;

				applyOverrides(finalHeader, paxGlobals);
				applyOverrides(finalHeader, nextEntryOverrides);

				// Only apply if name wasn't already overridden by PAX/GNU.
				if (
					header.prefix &&
					header.magic === "ustar" &&
					!nextEntryOverrides.name &&
					!paxGlobals.name
				) {
					finalHeader.name = `${header.prefix}/${finalHeader.name}`;
				}

				nextEntryOverrides = {}; // Reset for next cycle.

				let bodyController!: ReadableStreamDefaultController<Uint8Array>;
				const body = new ReadableStream({
					// biome-ignore lint/suspicious/noAssignInExpressions: This is more concise.
					start: (c) => (bodyController = c),
				});

				controller.enqueue({
					header: finalHeader,
					body,
				});

				if (finalHeader.size > 0) {
					currentEntry = {
						header: finalHeader,
						bytesLeft: finalHeader.size,
						controller: bodyController,
					};
				} else {
					// No body to read, close immediately.
					try {
						bodyController.close();
					} catch {
						// Suppress errors if stream is already closed.
					}
				}
			}

			// Continue to the next chunk.
		},

		flush(controller) {
			// If we were in the middle of reading an entry, that's an error.
			if (currentEntry) {
				if (strict) {
					const error = new Error("Tar archive is truncated.");
					currentEntry.controller.error(error);
					controller.error(error);
				} else {
					// In non-strict mode, just close the current entry stream.
					try {
						currentEntry.controller.close();
					} catch {
						// Suppress errors if stream is already closed or errored.
					}
				}
			}

			// Any leftover data in the chunks must be zeroes (padding).
			if (strict) {
				// Check the remaining part of the first chunk (if any)
				if (chunks.length > 0 && offset < chunks[0].length) {
					if (chunks[0].subarray(offset).some((b) => b !== 0)) {
						controller.error(new Error("Invalid EOF."));
						return;
					}
				}

				// Check all subsequent chunks
				for (let i = 1; i < chunks.length; i++) {
					if (chunks[i].some((b) => b !== 0)) {
						controller.error(new Error("Invalid EOF."));
						return;
					}
				}
			}
		},
	});
}

// Parses a 512-byte block into a USTAR header object using USTAR constants.
function parseUstarHeader(
	block: Uint8Array,
	strict: boolean,
): InternalTarHeader {
	if (strict && !validateChecksum(block)) {
		throw new Error("Invalid tar header checksum.");
	}

	const typeflag = readString(
		block,
		USTAR_TYPEFLAG_OFFSET,
		USTAR_TYPEFLAG_SIZE,
	) as keyof typeof FLAGTYPE;

	const magic = readString(block, USTAR_MAGIC_OFFSET, USTAR_MAGIC_SIZE);
	if (strict && magic !== "ustar") {
		throw new Error(`Invalid USTAR magic literal. Got "${magic}".`);
	}

	return {
		name: readString(block, USTAR_NAME_OFFSET, USTAR_NAME_SIZE),
		mode: readOctal(block, USTAR_MODE_OFFSET, USTAR_MODE_SIZE),
		uid: readNumeric(block, USTAR_UID_OFFSET, USTAR_UID_SIZE),
		gid: readNumeric(block, USTAR_GID_OFFSET, USTAR_GID_SIZE),
		size: readNumeric(block, USTAR_SIZE_OFFSET, USTAR_SIZE_SIZE),
		mtime: new Date(
			readNumeric(block, USTAR_MTIME_OFFSET, USTAR_MTIME_SIZE) * 1000,
		),
		checksum: readOctal(block, USTAR_CHECKSUM_OFFSET, USTAR_CHECKSUM_SIZE),
		type: FLAGTYPE[typeflag] || "file",
		linkname: readString(block, USTAR_LINKNAME_OFFSET, USTAR_LINKNAME_SIZE),
		magic,
		uname: readString(block, USTAR_UNAME_OFFSET, USTAR_UNAME_SIZE),
		gname: readString(block, USTAR_GNAME_OFFSET, USTAR_GNAME_SIZE),
		prefix: readString(block, USTAR_PREFIX_OFFSET, USTAR_PREFIX_SIZE),
	};
}

// Parses PAX record data into an overrides object.
function parsePax(buffer: Uint8Array): HeaderOverrides {
	const overrides: HeaderOverrides = {};
	const pax: Record<string, string> = {};
	let offset = 0;

	while (offset < buffer.length) {
		// Find the first space character to find the length of the record.
		const spaceIndex = buffer.indexOf(32, offset);
		if (spaceIndex === -1) break;

		// The length is the number before the space.
		const length = parseInt(
			decoder.decode(buffer.subarray(offset, spaceIndex)),
			10,
		);

		if (Number.isNaN(length) || length === 0) break;

		const recordEnd = offset + length;
		const recordStr = decoder.decode(
			buffer.subarray(spaceIndex + 1, recordEnd - 1),
		);

		// Split at the first '=' to get key and value.
		const [key, value] = recordStr.split("=", 2);
		if (key && value !== undefined) {
			pax[key] = value;
			switch (key) {
				case "path":
					overrides.name = value;
					break;
				case "linkpath":
					overrides.linkname = value;
					break;
				case "size":
					overrides.size = parseInt(value, 10);
					break;
				case "mtime":
					overrides.mtime = parseFloat(value);
					break;
				case "uid":
					overrides.uid = parseInt(value, 10);
					break;
				case "gid":
					overrides.gid = parseInt(value, 10);
					break;
				case "uname":
					overrides.uname = value;
					break;
				case "gname":
					overrides.gname = value;
					break;
			}
		}

		offset = recordEnd;
	}

	if (Object.keys(pax).length > 0) overrides.pax = pax;

	return overrides;
}

// Applies header extension overrides to a parsed USTAR header.
function applyOverrides(header: TarHeader, overrides: HeaderOverrides) {
	if (overrides.name !== undefined) header.name = overrides.name;
	if (overrides.linkname !== undefined) header.linkname = overrides.linkname;
	if (overrides.size !== undefined) header.size = overrides.size;
	if (overrides.mtime !== undefined)
		header.mtime = new Date(overrides.mtime * 1000);
	if (overrides.uid !== undefined) header.uid = overrides.uid;
	if (overrides.gid !== undefined) header.gid = overrides.gid;
	if (overrides.uname !== undefined) header.uname = overrides.uname;
	if (overrides.gname !== undefined) header.gname = overrides.gname;
	if (overrides.pax)
		header.pax = Object.assign({}, header.pax ?? {}, overrides.pax);
}

// A map of meta-header types to their respective data parsers.
function getMetaParser(
	type: string | undefined,
): ((data: Uint8Array) => HeaderOverrides) | undefined {
	switch (type) {
		case "pax-global-header":
		case "pax-header":
			return parsePax;
		case "gnu-long-name":
			return (data) => ({
				name: readString(data, 0, data.length),
			});
		case "gnu-long-link-name":
			return (data) => ({
				linkname: readString(data, 0, data.length),
			});
		default:
			return undefined;
	}
}
