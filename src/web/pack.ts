import { writeChecksum } from "./checksum";
import {
	BLOCK_SIZE,
	BLOCK_SIZE_MASK,
	DEFAULT_DIR_MODE,
	DEFAULT_FILE_MODE,
	TYPEFLAG,
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
	USTAR_VERSION,
	USTAR_VERSION_OFFSET,
	USTAR_VERSION_SIZE,
} from "./constants";
import { findUstarSplit, generatePax } from "./pack-pax";
import type { TarHeader } from "./types";
import { writeOctal, writeString } from "./utils";

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

			// Automatically generate and enqueue a PAX header if needed.
			const paxData = generatePax(header);
			if (paxData) {
				// @ts-expect-error - TypeScript is overly strict here, but Uint8Array is compatible here.
				streamController.enqueue(paxData.paxHeader);
				// @ts-expect-error - TypeScript is overly strict here, but Uint8Array is compatible here.
				streamController.enqueue(paxData.paxBody);

				const paxPadding = -paxData.paxBody.length & BLOCK_SIZE_MASK;

				if (paxPadding > 0) {
					streamController.enqueue(new Uint8Array(paxPadding));
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
							`"${header.name}" exceeds given size of ${size} bytes.`,
						);
						streamController.error(err);
						throw err; // Abort the write.
					}

					streamController.enqueue(chunk as Uint8Array<ArrayBuffer>);
				},

				close() {
					if (totalWritten !== size) {
						const err = new Error(`Size mismatch for "${header.name}".`);
						streamController.error(err);
						throw err;
					}

					// Pad the entry data to fill a complete 512-byte block.
					const paddingSize = -size & BLOCK_SIZE_MASK;
					if (paddingSize > 0)
						streamController.enqueue(new Uint8Array(paddingSize));
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

	// Do not attempt to split if a PAX header is being used for the path.
	if (!header.pax?.path) {
		const split = findUstarSplit(name);
		if (split) {
			name = split.name;
			prefix = split.prefix;
		}
	}

	writeString(view, USTAR_NAME_OFFSET, USTAR_NAME_SIZE, name);
	writeOctal(
		view,
		USTAR_MODE_OFFSET,
		USTAR_MODE_SIZE,
		header.mode ??
			(header.type === "directory" ? DEFAULT_DIR_MODE : DEFAULT_FILE_MODE),
	);
	writeOctal(view, USTAR_UID_OFFSET, USTAR_UID_SIZE, header.uid ?? 0);
	writeOctal(view, USTAR_GID_OFFSET, USTAR_GID_SIZE, header.gid ?? 0);
	writeOctal(view, USTAR_SIZE_OFFSET, USTAR_SIZE_SIZE, size);
	writeOctal(
		view,
		USTAR_MTIME_OFFSET,
		USTAR_MTIME_SIZE,
		Math.floor((header.mtime?.getTime() ?? Date.now()) / 1000),
	);
	writeString(
		view,
		USTAR_TYPEFLAG_OFFSET,
		USTAR_TYPEFLAG_SIZE,
		TYPEFLAG[header.type ?? "file"],
	);
	writeString(
		view,
		USTAR_LINKNAME_OFFSET,
		USTAR_LINKNAME_SIZE,
		header.linkname,
	);

	writeString(view, USTAR_MAGIC_OFFSET, USTAR_MAGIC_SIZE, "ustar\0");
	writeString(view, USTAR_VERSION_OFFSET, USTAR_VERSION_SIZE, USTAR_VERSION);
	writeString(view, USTAR_UNAME_OFFSET, USTAR_UNAME_SIZE, header.uname);
	writeString(view, USTAR_GNAME_OFFSET, USTAR_GNAME_SIZE, header.gname);
	writeString(view, USTAR_PREFIX_OFFSET, USTAR_PREFIX_SIZE, prefix);

	// Calculate and write the checksum.
	writeChecksum(view);

	return view;
}
