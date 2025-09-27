/** Size of a TAR block in bytes. */
export const BLOCK_SIZE = 512;

/** Default permissions for regular files (rw-r--r--). */
export const DEFAULT_FILE_MODE = 0o644;

/** Default permissions for directories (rwxr-xr-x). */
export const DEFAULT_DIR_MODE = 0o755;

/** Offsets and sizes of fields in a USTAR header block.
 *
 * @see https://www.gnu.org/software/tar/manual/html_node/Standard.html
 */
export const USTAR = {
	name: { offset: 0, size: 100 },
	mode: { offset: 100, size: 8 },
	uid: { offset: 108, size: 8 },
	gid: { offset: 116, size: 8 },
	size: { offset: 124, size: 12 },
	mtime: { offset: 136, size: 12 },
	checksum: { offset: 148, size: 8 },
	typeflag: { offset: 156, size: 1 },
	linkname: { offset: 157, size: 100 },
	magic: { offset: 257, size: 6 },
	version: { offset: 263, size: 2 },
	uname: { offset: 265, size: 32 },
	gname: { offset: 297, size: 32 },
	prefix: { offset: 345, size: 155 },
} as const;

/** USTAR version ("00"). */
export const USTAR_VERSION = "00";

/** Type flag constants for file types. */
export const TYPEFLAG = {
	file: "0",
	link: "1",
	symlink: "2",
	directory: "5",
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
	"5": "directory",
	// POSIX.1-2001 extensions
	x: "pax-header",
	g: "pax-global-header",
	// GNU extensions
	L: "gnu-long-name",
	K: "gnu-long-link-name",
} as const;
