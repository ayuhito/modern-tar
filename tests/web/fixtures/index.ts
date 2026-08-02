import { join } from "node:path";

const fixturePath = (name: string) => join(import.meta.dirname, name);

// Copied from https://github.com/mafintosh/tar-stream/tree/master/test/fixtures
export const ONE_FILE_TAR = fixturePath("one-file.tar");
export const MULTI_FILE_TAR = fixturePath("multi-file.tar");
export const PAX_TAR = fixturePath("pax.tar");
export const TYPES_TAR = fixturePath("types.tar");
export const LONG_NAME_TAR = fixturePath("long-name.tar");
export const UNICODE_BSD_TAR = fixturePath("unicode-bsd.tar");
export const UNICODE_TAR = fixturePath("unicode.tar");
export const NAME_IS_100_TAR = fixturePath("name-is-100.tar");
export const INVALID_TGZ = fixturePath("invalid.tgz");
export const SPACE_TAR_GZ = fixturePath("space.tar");
export const GNU_LONG_PATH = fixturePath("gnu-long-path.tar");
export const BASE_256_UID_GID = fixturePath("base-256-uid-gid.tar");
export const LARGE_UID_GID = fixturePath("large-uid-gid.tar");
export const BASE_256_SIZE = fixturePath("base-256-size.tar");
export const HUGE = fixturePath("huge.tar.gz");
export const LATIN1_TAR = fixturePath("latin1.tar");
export const INCOMPLETE_TAR = fixturePath("incomplete.tar");

// Created using gnu tar: tar cf gnu-incremental.tar --format gnu --owner=myuser:12345 --group=mygroup:67890 test.txt
export const GNU_TAR = fixturePath("gnu.tar");
// Created using gnu tar: tar cf gnu-incremental.tar -G --format gnu --owner=myuser:12345 --group=mygroup:67890 test.txt
export const GNU_INCREMENTAL_TAR = fixturePath("gnu-incremental.tar");
// Created from multi-file.tar, removing the magic and recomputing the checksum
export const UNKNOWN_FORMAT = fixturePath("unknown-format.tar");
// Created using gnu tar: tar cf v7.tar --format v7 test.txt
export const V7_TAR = fixturePath("v7.tar");
export const INVALID_TAR = fixturePath("invalid.tar");

// Real-world large packages for complex testing
export const LODASH_TGZ = fixturePath("lodash-4.17.21.tgz");
export const NEXT_SWC_TGZ = fixturePath("next-swc-linux-14.2.15.tgz");
export const SHARP_TGZ = fixturePath("sharp-0.33.5.tgz");
export const ELECTRON_TGZ = fixturePath("electron-33.0.2.tgz");
export const NODE_V25_DARWIN_ARM64_TAR_GZ = fixturePath(
	"node-v25.2.0-darwin-arm64.tar.gz",
);
export const TSGO_WASM_TGZ = fixturePath("tsgo-wasm-2025.12.7.tgz");
