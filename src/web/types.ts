import type { TarEntryData, TarHeader } from "../tar/types";

/**
 * Represents a complete entry to be packed into a tar archive.
 *
 * Combines header metadata with optional body data. Used as input to {@link packTar}
 * and the controller returned by {@link createTarPacker}.
 */
export interface TarEntry {
	header: TarHeader;
	body?: TarEntryData | ReadableStream<Uint8Array>;
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
