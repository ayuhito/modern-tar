import type { TYPEFLAG } from "./constants.js";

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
	type?: keyof typeof TYPEFLAG;
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
 */
export type TarEntryData =
	| string
	| Uint8Array
	| ArrayBuffer
	| Blob
	| null
	| undefined;

/**
 * Configuration options for creating a tar decoder stream.
 */
export interface DecoderOptions {
	/**
	 * Enable strict validation of the tar archive.
	 * When true, the decoder will throw errors for data corruption issues:
	 * - Invalid checksums (indicates header corruption)
	 * - Invalid USTAR magic string (format violation)
	 * @default false
	 */
	strict?: boolean;
}

/**
 * Platform-neutral configuration options for extracting tar archives.
 *
 * These options work with any tar extraction implementation and are not tied
 * to specific platforms like Node.js filesystem APIs.
 */
export interface UnpackOptions extends DecoderOptions {
	/** Number of leading path components to strip from entry names (e.g., strip: 1 removes first directory) */
	strip?: number;
	/** Filter function to include/exclude entries (return false to skip) */
	filter?: (header: TarHeader) => boolean;
	/** Transform function to modify tar headers before extraction */
	map?: (header: TarHeader) => TarHeader;
	/**
	 * The number of milliseconds of inactivity before a stream is considered stalled.
	 * Prevents hangs when processing corrupted or incomplete archives.
	 * @default 5000
	 */
	streamTimeout?: number;
}

/**
 * Handler interface for unpacking events.
 * Consumers implement this to define what happens when entries and data are found.
 */
export interface UnpackHandler {
	/** Called when a new entry header is parsed */
	onHeader(header: TarHeader): void;
	/** Called when data chunks are available for the current entry */
	onData(chunk: Uint8Array): void;
	/** Called when the current entry is complete */
	onEndEntry(): void;
	/** Called when an error occurs during unpacking */
	onError(error: Error): void;
}
