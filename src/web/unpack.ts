import { validateChecksum } from "./checksum";
import { BLOCK_SIZE, FLAGTYPE, USTAR } from "./constants";
import type { ParsedTarEntry, TarHeader } from "./types";
import { decoder, readOctal, readString } from "./utils";

interface InternalTarHeader extends TarHeader {
	checksum: number;
	magic: string;
	prefix: string;
}

type HeaderOverrides = Omit<Partial<TarHeader>, "mtime"> & {
	// PAX mtime is a float, handle it as a number before converting to Date
	mtime?: number;
};

// A map of meta-header types to their respective data parsers.
const metaEntryParsers: Record<string, (data: Uint8Array) => HeaderOverrides> =
	{
		"pax-global-header": parsePax,
		"pax-header": parsePax,
		"gnu-long-name": (data) => ({
			name: readString(data, 0, data.length),
		}),
		"gnu-long-link-name": (data) => ({
			linkname: readString(data, 0, data.length),
		}),
	};

/**
 * Create a transform stream that parses tar bytes into entries.
 *
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
export function createTarDecoder(): TransformStream<
	Uint8Array,
	ParsedTarEntry
> {
	let buffer = new Uint8Array(0);
	let currentEntry: {
		header: TarHeader;
		bytesLeft: number;
		controller: ReadableStreamDefaultController<Uint8Array>;
	} | null = null;
	let paxGlobals: HeaderOverrides = {};
	let nextEntryOverrides: HeaderOverrides = {};

	return new TransformStream({
		transform(chunk, controller) {
			// Combine buffer and new chunk.
			const combined = new Uint8Array(buffer.length + chunk.length);
			combined.set(buffer);
			combined.set(chunk, buffer.length);

			let offset = 0;

			while (true) {
				// Read an entry's body.
				if (currentEntry) {
					const toWrite = combined.subarray(
						offset,
						offset + Math.min(combined.length - offset, currentEntry.bytesLeft),
					);

					currentEntry.controller.enqueue(toWrite);

					// Update state after writing.
					currentEntry.bytesLeft -= toWrite.length;
					offset += toWrite.length;

					// If entry is complete, close its body stream and skip padding.
					if (currentEntry.bytesLeft === 0) {
						const padding =
							(BLOCK_SIZE - (currentEntry.header.size % BLOCK_SIZE)) %
							BLOCK_SIZE;

						if (combined.length - offset < padding) {
							break;
						}

						try {
							currentEntry?.controller.close();
						} catch {
							// Suppress errors if stream is already closed.
						}

						offset += padding;
						currentEntry = null;
					} else {
						// Body is not fully read, and we've run out of data in this chunk.
						break;
					}
				}

				// Read the next header block.
				if (combined.length - offset < BLOCK_SIZE) {
					break; // Not enough data for a header
				}

				// Check for two consecutive zero blocks indicating end of archive.
				const headerBlock = combined.subarray(offset, offset + BLOCK_SIZE);
				if (headerBlock.every((b) => b === 0)) {
					// Check if there's enough data to read before validating.
					if (combined.length - offset < BLOCK_SIZE * 2) break;

					// If the next block is also zero, then it's the end of the archive and we can stop.
					const nextBlock = combined.subarray(
						offset + BLOCK_SIZE,
						offset + BLOCK_SIZE * 2,
					);

					if (nextBlock.every((b) => b === 0)) {
						controller.terminate();
						return;
					}
				}

				// First parse USTAR headers as a base. Extension headers will override this as needed.
				const header = parseUstarHeader(headerBlock);

				// Check if the entry is a meta-entry (PAX, GNU, etc.)
				const metaParser =
					metaEntryParsers[header.type as keyof typeof metaEntryParsers];

				if (metaParser) {
					const dataSize = header.size;
					const dataBlocksSize = Math.ceil(dataSize / BLOCK_SIZE) * BLOCK_SIZE; // Padded to block size.

					if (combined.length - offset - BLOCK_SIZE < dataBlocksSize) {
						break; // Not enough data for the meta content
					}

					const data = combined.subarray(
						offset + BLOCK_SIZE,
						offset + BLOCK_SIZE + dataSize,
					);
					const overrides = metaParser(data);

					if (header.type === "pax-global-header") {
						paxGlobals = { ...paxGlobals, ...overrides };
					} else {
						// gnu-long-name, gnu-long-link-name, and pax-header all apply to the next entry
						nextEntryOverrides = { ...nextEntryOverrides, ...overrides };
					}

					offset += BLOCK_SIZE + dataBlocksSize;
					continue; // Move to the next header
				}

				// If we reach here, it is a regular entry.
				const finalHeader: TarHeader = header;

				applyOverrides(finalHeader, paxGlobals);
				applyOverrides(finalHeader, nextEntryOverrides);

				// Only apply if name wasn't already overridden by PAX/GNU
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

				offset += BLOCK_SIZE;

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

			// Save any remaining bytes for the next chunk.
			buffer = combined.subarray(offset);
		},

		flush(controller) {
			// If we were in the middle of reading an entry, that's an error.
			if (currentEntry) {
				const error = new Error("Tar archive is truncated.");
				// Error both the current entry and the main stream.
				currentEntry.controller.error(error);
				controller.error(error);
			}

			// Any leftover data in the buffer must be zeroes (padding).
			if (buffer.some((b) => b !== 0)) {
				controller.error(new Error("Unexpected data at end of archive."));
			}
		},
	});
}

// Parses a 512-byte block into a USTAR header object using USTAR constants.
function parseUstarHeader(block: Uint8Array): InternalTarHeader {
	if (!validateChecksum(block)) {
		throw new Error("Invalid tar header checksum.");
	}

	const typeflag = readString(
		block,
		USTAR.typeflag.offset,
		USTAR.typeflag.size,
	) as keyof typeof FLAGTYPE;

	return {
		name: readString(block, USTAR.name.offset, USTAR.name.size),
		mode: readOctal(block, USTAR.mode.offset, USTAR.mode.size),
		uid: readOctal(block, USTAR.uid.offset, USTAR.uid.size),
		gid: readOctal(block, USTAR.gid.offset, USTAR.gid.size),
		size: readOctal(block, USTAR.size.offset, USTAR.size.size),
		mtime: new Date(
			readOctal(block, USTAR.mtime.offset, USTAR.mtime.size) * 1000,
		),
		checksum: readOctal(block, USTAR.checksum.offset, USTAR.checksum.size),
		type: FLAGTYPE[typeflag] || "file",
		linkname: readString(block, USTAR.linkname.offset, USTAR.linkname.size),
		magic: readString(block, USTAR.magic.offset, USTAR.magic.size),
		uname: readString(block, USTAR.uname.offset, USTAR.uname.size),
		gname: readString(block, USTAR.gname.offset, USTAR.gname.size),
		prefix: readString(block, USTAR.prefix.offset, USTAR.prefix.size),
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
		const length = Number.parseInt(
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
					overrides.size = Number.parseInt(value, 10);
					break;
				case "mtime":
					overrides.mtime = Number.parseFloat(value);
					break;
				case "uid":
					overrides.uid = Number.parseInt(value, 10);
					break;
				case "gid":
					overrides.gid = Number.parseInt(value, 10);
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
	if (overrides.pax) header.pax = { ...(header.pax ?? {}), ...overrides.pax };
}
