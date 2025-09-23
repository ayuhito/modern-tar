/** Header information for a tar entry. */
export interface TarHeader {
	name: string;
	size: number;
	mtime?: Date;
	mode?: number; // e.g., 0o644
	type?:
		| "file"
		| "directory"
		| "symlink"
		| "link"
		| "pax-header"
		| "pax-global-header";
	uid?: number;
	gid?: number;
	uname?: string;
	gname?: string;
	linkname?: string; // For symlinks and hard links
	pax?: Record<string, string>; // Parsed PAX attributes
}

/** Represents a file or directory to be packed. The body can be many types for convenience. */
export type TarEntryData =
	| string
	| Uint8Array
	| ArrayBuffer
	| ReadableStream<Uint8Array>
	| Blob
	| null;

/** An entry object used for packing a tar archive. */
export interface TarEntry {
	header: TarHeader;
	body?: TarEntryData;
}

/** Represents an entry read from an archive. The body is always a stream. */
export interface ParsedTarEntry {
	header: TarHeader;
	body: ReadableStream<Uint8Array>;
}

/** Represents an extracted entry where the body has been buffered into a Uint8Array. */
export interface ParsedTarEntryWithData {
	header: TarHeader;
	data: Uint8Array;
}
