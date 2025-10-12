import type { Stats } from "node:fs";
import type { Readable } from "node:stream";
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
	/**
	 * Maximum number of concurrent filesystem operations during packing.
	 * @default os.cpus().length || 8
	 */
	concurrency?: number;
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

/** Base interface containing common metadata properties for all source types. */
export interface BaseSource {
	/** Destination path for the entry inside the tar archive. */
	target: string;
	/** Optional modification time. Overrides filesystem values or defaults to current time. */
	mtime?: Date;
	/** Optional user ID. Overrides filesystem values or defaults to 0. */
	uid?: number;
	/** Optional group ID. Overrides filesystem values or defaults to 0. */
	gid?: number;
	/** Optional user name. */
	uname?: string;
	/** Optional group name. */
	gname?: string;
	/** Optional Unix file permissions for the entry (e.g., 0o644, 0o755). */
	mode?: number;
}

/** Describes a file on the local filesystem to be added to the archive. */
export interface FileSource extends BaseSource {
	type: "file";
	/** Path to the source file on the local filesystem. */
	source: string;
}

/** Describes a directory on the local filesystem to be added to the archive. */
export interface DirectorySource extends BaseSource {
	type: "directory";
	/** Path to the source directory on the local filesystem. */
	source: string;
}

/** Describes raw, buffered content to be added to the archive. */
export interface ContentSource extends BaseSource {
	type: "content";
	/** Raw content to add. Supports string, Uint8Array, ArrayBuffer, Blob, or null. */
	content: TarEntryData;
}

/** Describes a stream of content to be added to the archive. */
export interface StreamSource extends BaseSource {
	type: "stream";
	/** A Readable or ReadableStream. */
	content: Readable | ReadableStream;
	/** The total size of the stream's content in bytes. This is required for streams. */
	size: number;
}

/** A union of all possible source types for creating a tar archive. */
export type TarSource =
	| FileSource
	| DirectorySource
	| ContentSource
	| StreamSource;
