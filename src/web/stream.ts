import { BLOCK_SIZE, FLAGTYPE, USTAR } from "./constants";
import type { ParsedTarEntry, TarHeader } from "./types";
import { decoder, readOctal, readString } from "./utils";

function parseHeader(block: Uint8Array): TarHeader {
	let name = readString(block, USTAR.name.offset, USTAR.name.size);

	// The "ustar" magic string is 5 bytes, followed by a NUL.
	const isUstar =
		readString(block, USTAR.magic.offset, USTAR.magic.size) === "ustar";

	if (isUstar) {
		const prefix = readString(block, USTAR.prefix.offset, USTAR.prefix.size);
		if (prefix) {
			name = `${prefix}/${name}`;
		}
	}

	const typeFlag = readString(
		block,
		USTAR.typeflag.offset,
		USTAR.typeflag.size,
	) as keyof typeof FLAGTYPE;

	return {
		name,
		mode: readOctal(block, USTAR.mode.offset, USTAR.mode.size),
		uid: readOctal(block, USTAR.uid.offset, USTAR.uid.size),
		gid: readOctal(block, USTAR.gid.offset, USTAR.gid.size),
		size: readOctal(block, USTAR.size.offset, USTAR.size.size),
		mtime: new Date(
			readOctal(block, USTAR.mtime.offset, USTAR.mtime.size) * 1000,
		),
		type: FLAGTYPE[typeFlag] || "file",
		linkname: readString(block, USTAR.linkname.offset, USTAR.linkname.size),
		uname: readString(block, USTAR.uname.offset, USTAR.uname.size),
		gname: readString(block, USTAR.gname.offset, USTAR.gname.size),
	};
}

function parsePax(buffer: Uint8Array): Record<string, string> {
	const pax: Record<string, string> = {};

	let offset = 0;
	while (offset < buffer.length) {
		// Find the first space character to find the length of the record.
		const spaceIndex = buffer.indexOf(32, offset);
		if (spaceIndex === -1) break;

		const lengthStr = decoder.decode(buffer.subarray(offset, spaceIndex));
		const length = Number.parseInt(lengthStr, 10);
		if (!length) break;

		const recordEnd = offset + length;
		const recordStr = decoder.decode(
			buffer.subarray(spaceIndex + 1, recordEnd - 1),
		);

		const [key, value] = recordStr.split("=", 2);
		if (key && value !== undefined) {
			pax[key] = value;
		}

		offset = recordEnd;
	}

	return pax;
}

// Helper to apply PAX metadata to a USTAR header.
function applyPax(header: TarHeader, pax: Record<string, string>) {
	header.name = pax.path ?? header.name;
	header.linkname = pax.linkpath ?? header.linkname;

	if (pax.size) header.size = Number.parseInt(pax.size, 10);
	if (pax.mtime) header.mtime = new Date(Number.parseFloat(pax.mtime) * 1000);
	if (pax.uid) header.uid = Number.parseInt(pax.uid, 10);
	if (pax.gid) header.gid = Number.parseInt(pax.gid, 10);

	header.uname = pax.uname ?? header.uname;
	header.gname = pax.gname ?? header.gname;
	header.pax = pax;
}

/**
 * Creates a TransformStream that parses a tar archive into ParsedTarEntry objects.
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
	let pax: Record<string, string> | null = null;
	let paxGlobal: Record<string, string> = {};

	const closeEntryBody = () => {
		try {
			currentEntry?.controller.close();
		} catch {
			// Suppress errors if stream is already closed.
		}
	};

	return new TransformStream({
		transform(chunk, controller) {
			// Combine buffer and new chunk.
			const combined = new Uint8Array(buffer.length + chunk.length);
			combined.set(buffer);
			combined.set(chunk, buffer.length);

			let offset = 0;

			while (true) {
				const remainingBytes = combined.length - offset;

				// Read an entry's body.
				if (currentEntry) {
					const toWrite = combined.subarray(
						offset,
						offset + Math.min(remainingBytes, currentEntry.bytesLeft),
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

						if (remainingBytes - toWrite.length < padding) {
							break;
						}

						closeEntryBody();
						offset += padding;
						currentEntry = null;
					} else {
						// Body is not fully read, and we've run out of data in this chunk.
						break;
					}
				}

				// Read the next header block.
				if (remainingBytes < BLOCK_SIZE) {
					break;
				}

				// Check for two consecutive zero blocks indicating end of archive.
				const headerBlock = combined.subarray(offset, offset + BLOCK_SIZE);
				if (headerBlock.every((b) => b === 0)) {
					controller.terminate();
					return;
				}

				const header = parseHeader(headerBlock);
				offset += BLOCK_SIZE;

				// Handle PAX headers.
				if (
					header.type === "pax-header" ||
					header.type === "pax-global-header"
				) {
					const totalPaxSize =
						header.size +
						((BLOCK_SIZE - (header.size % BLOCK_SIZE)) % BLOCK_SIZE);

					// Ensure the full PAX data is available.
					if (combined.length - offset < totalPaxSize) {
						offset -= BLOCK_SIZE; // Rewind
						break;
					}

					const parsedPax = parsePax(
						combined.subarray(offset, offset + header.size),
					);

					if (header.type === "pax-header") {
						pax = parsedPax;
					} else {
						paxGlobal = { ...paxGlobal, ...parsedPax };
					}

					offset += totalPaxSize;
					continue;
				}

				const combinedPax = { ...paxGlobal, ...pax };
				if (pax || Object.keys(paxGlobal).length > 0) {
					applyPax(header, combinedPax);
					pax = null;
				}

				// Enqueue the new entry with its body stream.
				let bodyController: ReadableStreamDefaultController<Uint8Array>;

				// biome-ignore lint/suspicious/noAssignInExpressions: This is intentional.
				const body = new ReadableStream({ start: (c) => (bodyController = c) });
				controller.enqueue({ header, body });

				if (header.size > 0) {
					currentEntry = {
						header,
						bytesLeft: header.size,
						// biome-ignore lint/style/noNonNullAssertion: This is safe because start is called.
						controller: bodyController!,
					};
				} else {
					try {
						// biome-ignore lint/style/noNonNullAssertion: This is safe because start is called.
						bodyController!.close();
					} catch {}
				}
			}

			// Save any leftover bytes for the next chunk.
			buffer = combined.subarray(offset);
		},

		flush(controller) {
			if (currentEntry) {
				const error = new Error("Tar archive is truncated.");

				// Error both the current entry and the main stream.
				currentEntry.controller.error(error);
				controller.error(error);
			}

			// Check for non-zero bytes in the leftover buffer.
			if (buffer.some((b) => b !== 0))
				controller.error(new Error("Unexpected data at end of archive."));
		},
	});
}
