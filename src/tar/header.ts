import { validateChecksum, writeChecksum } from "./checksum";
import {
	BLOCK_SIZE,
	BLOCK_SIZE_MASK,
	DEFAULT_DIR_MODE,
	DEFAULT_FILE_MODE,
	FLAGTYPE,
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
	ZERO_BLOCK,
} from "./constants";
import { findUstarSplit, generatePax } from "./pax";
import type { TarHeader } from "./types";
import {
	readNumeric,
	readOctal,
	readString,
	writeOctal,
	writeString,
} from "./utils";

// Internal header with additional fields needed during parsing.
export interface InternalTarHeader extends TarHeader {
	prefix?: string;
}

// Header overrides for PAX extensions.
export type HeaderOverrides = Omit<Partial<TarHeader>, "mtime"> & {
	// PAX mtime is a float, handle it as a number before converting to Date
	mtime?: number;
};

// Creates a USTAR format tar header from a TarHeader object.
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

// Parses a USTAR format tar header from a 512-byte block.
export function parseUstarHeader(
	block: Uint8Array,
	strict: boolean,
): InternalTarHeader {
	if (strict && !validateChecksum(block)) {
		throw new Error("Invalid tar header checksum.");
	}

	const typeflag = readString(
		block,
		USTAR_TYPEFLAG_OFFSET,
		USTAR_TYPEFLAG_SIZE,
	) as keyof typeof FLAGTYPE;

	const header: InternalTarHeader = {
		name: readString(block, USTAR_NAME_OFFSET, USTAR_NAME_SIZE),
		mode: readOctal(block, USTAR_MODE_OFFSET, USTAR_MODE_SIZE),
		uid: readNumeric(block, USTAR_UID_OFFSET, USTAR_UID_SIZE),
		gid: readNumeric(block, USTAR_GID_OFFSET, USTAR_GID_SIZE),
		size: readNumeric(block, USTAR_SIZE_OFFSET, USTAR_SIZE_SIZE),
		mtime: new Date(
			readNumeric(block, USTAR_MTIME_OFFSET, USTAR_MTIME_SIZE) * 1000,
		),
		type: FLAGTYPE[typeflag] || "file",
		linkname: readString(block, USTAR_LINKNAME_OFFSET, USTAR_LINKNAME_SIZE),
	};

	const magic = readString(block, USTAR_MAGIC_OFFSET, USTAR_MAGIC_SIZE);

	// Both GNU and USTAR formats have uname and gname.
	if (magic.trim() === "ustar") {
		header.uname = readString(block, USTAR_UNAME_OFFSET, USTAR_UNAME_SIZE);
		header.gname = readString(block, USTAR_GNAME_OFFSET, USTAR_GNAME_SIZE);
	}

	// Only standard USTAR (not GNU tar) has valid prefix field for pathnames.
	// GNU tar uses "ustar  " and repurposes prefix for timestamp metadata.
	if (magic === "ustar")
		header.prefix = readString(block, USTAR_PREFIX_OFFSET, USTAR_PREFIX_SIZE);

	return header;
}

// Parses PAX record data into an overrides object.
export function parsePax(buffer: Uint8Array): HeaderOverrides {
	const decoder = new TextDecoder("utf-8");
	const overrides: HeaderOverrides = {};
	const pax: Record<string, string> = {};
	let offset = 0;

	while (offset < buffer.length) {
		// Find the first space character to find the length of the record.
		const spaceIndex = buffer.indexOf(32, offset);
		if (spaceIndex === -1) break;

		// The length is the number before the space.
		const length = parseInt(
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
					overrides.size = parseInt(value, 10);
					break;
				case "mtime":
					overrides.mtime = parseFloat(value);
					break;
				case "uid":
					overrides.uid = parseInt(value, 10);
					break;
				case "gid":
					overrides.gid = parseInt(value, 10);
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
export function applyOverrides(
	header: TarHeader,
	overrides: HeaderOverrides,
): void {
	if (overrides.name !== undefined) header.name = overrides.name;
	if (overrides.linkname !== undefined) header.linkname = overrides.linkname;
	if (overrides.size !== undefined) header.size = overrides.size;
	if (overrides.mtime !== undefined)
		header.mtime = new Date(overrides.mtime * 1000);
	if (overrides.uid !== undefined) header.uid = overrides.uid;
	if (overrides.gid !== undefined) header.gid = overrides.gid;
	if (overrides.uname !== undefined) header.uname = overrides.uname;
	if (overrides.gname !== undefined) header.gname = overrides.gname;
	if (overrides.pax)
		header.pax = Object.assign({}, header.pax ?? {}, overrides.pax);
}

// Gets the appropriate meta header parser for a given entry type.
export function getMetaParser(
	type: string | undefined,
): ((data: Uint8Array) => HeaderOverrides) | undefined {
	switch (type) {
		case "pax-global-header":
		case "pax-header":
			return parsePax;
		case "gnu-long-name":
			return (data) => ({
				name: readString(data, 0, data.length),
			});
		case "gnu-long-link-name":
			return (data) => ({
				linkname: readString(data, 0, data.length),
			});
		default:
			return undefined;
	}
}

export function getHeaderBlocks(header: TarHeader): Uint8Array[] {
	const base = createTarHeader(header);
	const pax = generatePax(header);

	// Skip PAX if not needed.
	if (!pax) return [base];

	// Calculate padding for the PAX body.
	const paxPadding = -pax.paxBody.length & BLOCK_SIZE_MASK;
	const paddingBlocks =
		paxPadding > 0 ? [ZERO_BLOCK.subarray(0, paxPadding)] : [];

	return [pax.paxHeader, pax.paxBody, ...paddingBlocks, base];
}
