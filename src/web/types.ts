/**
 * Header information for a tar entry in USTAR format.
 */
export interface TarHeader {
	/** Entry name/path. Can be up to 255 characters with USTAR prefix extension. */
	name: string;
	/** Size of the entry data in bytes. Should be 0 for directories, symlinks, and hardlinks. */
	size: number;
	/** Modification time as a `Date` object. Defaults to current time if not specified. */
	mtime?: Date;
	/** Unix file permissions as an octal number (e.g., 0o644 for rw-r--r--). Defaults to 0o644 for files and 0o755 for directories. */
	mode?: number;
	/** Entry type. Defaults to "file" if not specified. */
	type?:
		| "file"
		| "directory"
		| "symlink"
		| "link"
		| "pax-header"
		| "pax-global-header";
	/** User ID of the entry owner. */
	uid?: number;
	/** Group ID of the entry owner. */
	gid?: number;
	/** User name of the entry owner. */
	uname?: string;
	/** Group name of the entry owner. */
	gname?: string;
	/** Target path for symlinks and hard links. */
	linkname?: string;
	/** PAX extended attributes as key-value pairs. */
	pax?: Record<string, string>;
}

/**
 * Union type for entry body data that can be packed into a tar archive.
 *
 * Supports multiple input types for convenience:
 * - `string` - Text content (encoded as UTF-8)
 * - `Uint8Array` - Binary data
 * - `ArrayBuffer` - Binary data
 * - `ReadableStream<Uint8Array>` - Streaming data
 * - `Blob` - File-like data
 * - `null` - No content (for directories, etc.)
 */
export type TarEntryData =
	| string
	| Uint8Array
	| ArrayBuffer
	| ReadableStream<Uint8Array>
	| Blob
	| null
	| undefined;

/**
 * Represents a complete entry to be packed into a tar archive.
 *
 * Combines header metadata with optional body data. Used as input to {@link packTar}
 * and the controller returned by {@link createTarPacker}.
 */
export interface TarEntry {
	header: TarHeader;
	body?: TarEntryData;
}

/**
 * Represents an entry parsed from a tar archive stream.
 */
export interface ParsedTarEntry {
	header: TarHeader;
	body: ReadableStream<Uint8Array>;
}

/**
 * Represents an extracted entry with fully buffered content.

 */
export interface ParsedTarEntryWithData {
	header: TarHeader;
	data: Uint8Array;
}

/**
 * Platform-neutral configuration options for extracting tar archives.
 *
 * These options work with any tar extraction implementation and are not tied
 * to specific platforms like Node.js filesystem APIs.
 */
export interface UnpackOptions {
	/** Number of leading path components to strip from entry names (e.g., strip: 1 removes first directory) */
	strip?: number;
	/** Filter function to include/exclude entries (return false to skip) */
	filter?: (header: TarHeader) => boolean;
	/** Transform function to modify tar headers before extraction */
	map?: (header: TarHeader) => TarHeader;
}
