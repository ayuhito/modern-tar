/** Size of a TAR block in bytes. */
export const BLOCK_SIZE = 512;

/** Bitwise mask for calculating remainders when dividing by BLOCK_SIZE. Equal to BLOCK_SIZE - 1. */
export const BLOCK_SIZE_MASK = 511;

/** Default permissions for regular files (rw-r--r--). */
export const DEFAULT_FILE_MODE = 0o644;

/** Default permissions for directories (rwxr-xr-x). */
export const DEFAULT_DIR_MODE = 0o755;

// Offsets and sizes of fields in a USTAR header block.
// @see https://www.gnu.org/software/tar/manual/html_node/Standard.html

// Name field
export const USTAR_NAME_OFFSET = 0;
export const USTAR_NAME_SIZE = 100;

// Mode field
export const USTAR_MODE_OFFSET = 100;
export const USTAR_MODE_SIZE = 8;

// UID field
export const USTAR_UID_OFFSET = 108;
export const USTAR_UID_SIZE = 8;

// GID field
export const USTAR_GID_OFFSET = 116;
export const USTAR_GID_SIZE = 8;

// Size field
export const USTAR_SIZE_OFFSET = 124;
export const USTAR_SIZE_SIZE = 12;

// Mtime field
export const USTAR_MTIME_OFFSET = 136;
export const USTAR_MTIME_SIZE = 12;

// Checksum field
export const USTAR_CHECKSUM_OFFSET = 148;
export const USTAR_CHECKSUM_SIZE = 8;

// Typeflag field
export const USTAR_TYPEFLAG_OFFSET = 156;
export const USTAR_TYPEFLAG_SIZE = 1;

// Linkname field
export const USTAR_LINKNAME_OFFSET = 157;
export const USTAR_LINKNAME_SIZE = 100;

// Magic field
export const USTAR_MAGIC_OFFSET = 257;
export const USTAR_MAGIC_SIZE = 6;

// Version field
export const USTAR_VERSION_OFFSET = 263;
export const USTAR_VERSION_SIZE = 2;

// Uname field
export const USTAR_UNAME_OFFSET = 265;
export const USTAR_UNAME_SIZE = 32;

// Gname field
export const USTAR_GNAME_OFFSET = 297;
export const USTAR_GNAME_SIZE = 32;

// Prefix field
export const USTAR_PREFIX_OFFSET = 345;
export const USTAR_PREFIX_SIZE = 155;

/** USTAR version ("00"). */
export const USTAR_VERSION = "00";

/** USTAR max value in 8-byte octal field. */
export const USTAR_MAX_UID_GID = 0o7777777;

/** USTAR max value in 12-byte octal field (~8GB). */
export const USTAR_MAX_SIZE = 0o77777777777;

/** Type flag constants for file types. */
export const TYPEFLAG = {
	file: "0",
	link: "1",
	symlink: "2",
	"character-device": "3",
	"block-device": "4",
	directory: "5",
	fifo: "6",
	// POSIX.1-2001 extensions
	"pax-header": "x",
	"pax-global-header": "g",
	// GNU extensions
	"gnu-long-name": "L",
	"gnu-long-link-name": "K",
} as const;

/** Reverse mapping from flag characters to type names. */
export const FLAGTYPE = {
	"0": "file",
	"1": "link",
	"2": "symlink",
	"3": "character-device",
	"4": "block-device",
	"5": "directory",
	"6": "fifo",
	// POSIX.1-2001 extensions
	x: "pax-header",
	g: "pax-global-header",
	// GNU extensions
	L: "gnu-long-name",
	K: "gnu-long-link-name",
} as const;

/** Pre-allocated zero block for padding and EOF. */
export const ZERO_BLOCK = new Uint8Array(BLOCK_SIZE);
