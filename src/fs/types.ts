import type { Stats } from "node:fs";
import type { TarEntryData, TarHeader, UnpackOptions } from "../tar/types";

/**
 * Filesystem-specific configuration options for packing directories into tar archives.
 *
 * These options are specific to Node.js filesystem operations and use Node.js-specific
 * types like `Stats` for file system metadata.
 */
export interface PackOptionsFS {
	/** Follow symlinks instead of storing them as symlinks (default: false) */
	dereference?: boolean;
	/** Filter function to include/exclude files (return false to exclude) */
	filter?: (path: string, stat: Stats) => boolean;
	/** Transform function to modify tar headers before packing */
	map?: (header: TarHeader) => TarHeader;
	/** Base directory for symlink security validation, when `dereference` is set to true. */
	baseDir?: string;
}

/**
 * Filesystem-specific configuration options for extracting tar archives to the filesystem.
 *
 * Extends the core {@link UnpackOptions} with Node.js filesystem-specific settings
 * for controlling file permissions and other filesystem behaviors.
 */
export interface UnpackOptionsFS extends UnpackOptions {
	/** Default mode for created directories (e.g., 0o755). If not specified, uses mode from tar header or system default */
	dmode?: number;
	/** Default mode for created files (e.g., 0o644). If not specified, uses mode from tar header or system default */
	fmode?: number;
	/**
	 * The maximum depth of paths to extract. Prevents Denial of Service (DoS) attacks
	 * from malicious archives with deeply nested directories.
	 *
	 * Set to `Infinity` to disable depth checking (not recommended for untrusted archives).
	 * @default 1024
	 */
	maxDepth?: number;
	/**
	 * Maximum number of concurrent filesystem operations during extraction.
	 * @default os.cpus().length || 8
	 */
	concurrency?: number;
}

/** Describes a file on the local filesystem to be added to the archive. */
export interface FileSource {
	type: "file";
	/** Path to the source file on the local filesystem. */
	source: string;
	/** Destination path for the file inside the tar archive. */
	target: string;
}

/** Describes a directory on the local filesystem to be added to the archive. */
export interface DirectorySource {
	type: "directory";
	/** Path to the source directory on the local filesystem. */
	source: string;
	/** Destination path for the directory inside the tar archive. */
	target: string;
}

/** Describes raw content to be added to the archive. Supports all TarEntryData types including strings, buffers, streams, blobs, and null. */
export interface ContentSource {
	type: "content";
	/** Raw content to add. Supports string, Uint8Array, ArrayBuffer, ReadableStream, Blob, or null. */
	content: TarEntryData;
	/** Destination path for the content inside the tar archive. */
	target: string;
	/** Optional Unix file permissions for the entry (e.g., 0o644). */
	mode?: number;
}

/** A union of all possible source types for creating a tar archive. */
export type TarSource = FileSource | DirectorySource | ContentSource;
