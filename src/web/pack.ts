import { writeChecksum } from "./checksum";
import {
	BLOCK_SIZE,
	DEFAULT_DIR_MODE,
	DEFAULT_FILE_MODE,
	TYPEFLAG,
	USTAR,
	USTAR_VERSION,
} from "./constants";
import type { TarHeader } from "./types";
import { encoder, writeOctal, writeString } from "./utils";

/**
 * Controls a streaming tar packing process.
 *
 * Provides methods to add entries to a tar archive and finalize the stream.
 * This is the advanced API for streaming tar creation, allowing you to dynamically
 * add entries and write their content as a [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream).
 */
export interface TarPackController {
	/**
	 * Add an entry to the tar archive.
	 *
	 * After adding the entry, you must write exactly `header.size` bytes of data
	 * to the returned [`WritableStream`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStream)
	 * and then close it. For entries that do not have a body (e.g., directories),
	 * the size property should be set to 0 and the stream should be closed immediately.
	 *
	 * @param header - The tar header for the entry. The `size` property must be accurate
	 * @returns A [`WritableStream`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStream) for writing the entry's body data
	 *
	 * @example
	 * ```typescript
	 * // Add a text file
	 * const fileStream = controller.add({
	 *   name: "file.txt",
	 *   size: 11,
	 *   type: "file"
	 * });
	 *
	 * const writer = fileStream.getWriter();
	 * await writer.write(new TextEncoder().encode("hello world"));
	 * await writer.close();
	 *
	 * // Add a directory
	 * const dirStream = controller.add({
	 *   name: "folder/",
	 *   type: "directory",
	 *   size: 0
	 * });
	 * await dirStream.close(); // Directories have no content
	 * ```
	 */
	add(header: TarHeader): WritableStream<Uint8Array>;

	/**
	 * Finalize the archive.
	 *
	 * Must be called after all entries have been added.
	 * This writes the end-of-archive marker and closes the readable stream.
	 */
	finalize(): void;

	/**
	 * Abort the packing process with an error.
	 *
	 * @param err - The error that caused the abort
	 */
	error(err: unknown): void;
}

/**
 * Create a streaming tar packer.
 *
 * Provides a controller-based API for creating tar archives, suitable for scenarios where entries are
 * generated dynamically. The returned [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)
 * outputs tar archive bytes as entries are added.
 *
 * @returns Object containing the readable stream and controller
 * @returns readable - [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) that outputs the tar archive bytes
 * @returns controller - {@link TarPackController} for adding entries and finalizing
 *
 * @example
 * ```typescript
 * import { createTarPacker } from 'modern-tar';
 *
 * const { readable, controller } = createTarPacker();
 *
 * // Add entries dynamically
 * const fileStream = controller.add({
 *   name: "dynamic.txt",
 *   size: 5,
 *   type: "file"
 * });
 *
 * const writer = fileStream.getWriter();
 * await writer.write(new TextEncoder().encode("hello"));
 * await writer.close();
 *
 * // Add multiple entries
 * const jsonStream = controller.add({
 *   name: "data.json",
 *   size: 13,
 *   type: "file"
 * });
 * const jsonWriter = jsonStream.getWriter();
 * await jsonWriter.write(new TextEncoder().encode('{"test":true}'));
 * await jsonWriter.close();
 *
 * // Finalize the archive
 * controller.finalize();
 *
 * // Use the readable stream
 * const response = new Response(readable);
 * const buffer = await response.arrayBuffer();
 * ```
 */
export function createTarPacker(): {
	readable: ReadableStream<Uint8Array>;
	controller: TarPackController;
} {
	let streamController: ReadableStreamController<Uint8Array>;

	const readable = new ReadableStream<Uint8Array>({
		start(controller) {
			streamController = controller;
		},
	});

	const packController: TarPackController = {
		add(header: TarHeader): WritableStream<Uint8Array> {
			const isBodyless =
				header.type === "directory" ||
				header.type === "symlink" ||
				header.type === "link";
			const size = isBodyless ? 0 : (header.size ?? 0);

			// Generate PAX header if the pax field is present.
			if (header.pax) {
				let paxRecords = "";
				for (const [key, value] of Object.entries(header.pax)) {
					// Format for each PAX record is: "<length> <key>=<value>\n"
					const record = `${key}=${value}\n`;

					// The length field must include the bytes for the length string itself,
					// plus a space and the record.
					let length = record.length + 1; // +1 for the space
					const lengthStr = String(length);
					length += lengthStr.length;

					// If adding the length digits changes the total length's number of digits
					// (e.g., from 99 to 100), we need to adjust the length one last time.
					const finalLengthStr = String(length);
					if (finalLengthStr.length !== lengthStr.length) {
						length += finalLengthStr.length - lengthStr.length;
					}

					paxRecords += `${length} ${record}`;
				}

				// Only proceed if we actually generated PAX records.
				if (paxRecords) {
					const paxBytes = encoder.encode(paxRecords);

					// Create and enqueue the PAX header entry.
					const paxHeader = createTarHeader({
						name: `PaxHeader/${header.name}`,
						size: paxBytes.length,
						type: "pax-header",
						mode: 0o644,
						mtime: header.mtime,
					});
					streamController.enqueue(paxHeader as Uint8Array<ArrayBuffer>);

					// Enqueue the PAX data itself.
					streamController.enqueue(paxBytes);

					// Add padding to align the PAX data to a 512-byte block boundary.
					const paxPadding =
						(BLOCK_SIZE - (paxBytes.length % BLOCK_SIZE)) % BLOCK_SIZE;

					if (paxPadding > 0) {
						streamController.enqueue(new Uint8Array(paxPadding));
					}
				}
			}

			// Create and enqueue the main USTAR header for the file entry.
			const headerBlock = createTarHeader({ ...header, size });
			streamController.enqueue(headerBlock as Uint8Array<ArrayBuffer>);

			let totalWritten = 0;

			return new WritableStream<Uint8Array>({
				write(chunk) {
					totalWritten += chunk.length;
					if (totalWritten > size) {
						const err = new Error(
							`Entry '${header.name}' is larger than its specified size of ${size} bytes.`,
						);
						streamController.error(err);
						throw err; // Abort the write.
					}

					streamController.enqueue(chunk as Uint8Array<ArrayBuffer>);
				},

				close() {
					if (totalWritten !== size) {
						const err = new Error(
							`Size mismatch for entry '${header.name}': expected ${size} bytes but received ${totalWritten}.`,
						);
						streamController.error(err);
						throw err;
					}

					// Pad the entry data to fill a complete 512-byte block.
					const paddingSize = (BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE;
					if (paddingSize > 0) {
						streamController.enqueue(new Uint8Array(paddingSize));
					}
				},
				abort(reason) {
					streamController.error(reason);
				},
			});
		},

		finalize() {
			// A valid tar archive ends with two 512-byte empty blocks.
			streamController.enqueue(new Uint8Array(BLOCK_SIZE * 2));
			streamController.close();
		},

		error(err: unknown) {
			streamController.error(err);
		},
	};

	return { readable, controller: packController };
}

/**
 * Creates a 512-byte USTAR format tar header block from a TarHeader object.
 */
export function createTarHeader(header: TarHeader): Uint8Array {
	const view = new Uint8Array(BLOCK_SIZE);

	// Entries without a data body (like directories) have a size of 0.
	const isBodyless =
		header.type === "directory" ||
		header.type === "symlink" ||
		header.type === "link";
	const size = isBodyless ? 0 : (header.size ?? 0);

	// If a filename is >100 chars, USTAR allows splitting it into a 155-char prefix and a 100-char name.
	let name = header.name;
	let prefix = "";

	if (name.length > USTAR.name.size) {
		// We search backwards for the rightmost '/' that allows a valid split.
		let i = name.length;
		while (i > 0) {
			const slashIndex = name.lastIndexOf("/", i);
			// No suitable slash found.
			if (slashIndex === -1) break;

			const p = name.slice(0, slashIndex);
			const n = name.slice(slashIndex + 1);

			if (p.length <= USTAR.prefix.size && n.length <= USTAR.name.size) {
				prefix = p;
				name = n;
				break;
			}

			// Continue searching from before the current slash.
			i = slashIndex - 1;
		}
	}

	writeString(view, USTAR.name.offset, USTAR.name.size, name);
	writeOctal(
		view,
		USTAR.mode.offset,
		USTAR.mode.size,
		header.mode ??
			(header.type === "directory" ? DEFAULT_DIR_MODE : DEFAULT_FILE_MODE),
	);
	writeOctal(view, USTAR.uid.offset, USTAR.uid.size, header.uid ?? 0);
	writeOctal(view, USTAR.gid.offset, USTAR.gid.size, header.gid ?? 0);
	writeOctal(view, USTAR.size.offset, USTAR.size.size, size);
	writeOctal(
		view,
		USTAR.mtime.offset,
		USTAR.mtime.size,
		Math.floor((header.mtime?.getTime() ?? Date.now()) / 1000),
	);
	writeString(
		view,
		USTAR.typeflag.offset,
		USTAR.typeflag.size,
		TYPEFLAG[header.type ?? "file"],
	);
	writeString(
		view,
		USTAR.linkname.offset,
		USTAR.linkname.size,
		header.linkname,
	);

	writeString(view, USTAR.magic.offset, USTAR.magic.size, "ustar\0");
	writeString(view, USTAR.version.offset, USTAR.version.size, USTAR_VERSION);
	writeString(view, USTAR.uname.offset, USTAR.uname.size, header.uname);
	writeString(view, USTAR.gname.offset, USTAR.gname.size, header.gname);
	writeString(view, USTAR.prefix.offset, USTAR.prefix.size, prefix);

	// Calculate and write the checksum.
	writeChecksum(view);

	return view;
}
