import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Copied from https://github.com/mafintosh/tar-stream/tree/master/test/fixtures
export const ONE_FILE_TAR = join(__dirname, "one-file.tar");
export const MULTI_FILE_TAR = join(__dirname, "multi-file.tar");
export const PAX_TAR = join(__dirname, "pax.tar");
export const TYPES_TAR = join(__dirname, "types.tar");
export const LONG_NAME_TAR = join(__dirname, "long-name.tar");
export const UNICODE_BSD_TAR = join(__dirname, "unicode-bsd.tar");
export const UNICODE_TAR = join(__dirname, "unicode.tar");
export const NAME_IS_100_TAR = join(__dirname, "name-is-100.tar");
export const INVALID_TGZ = join(__dirname, "invalid.tgz");
export const SPACE_TAR_GZ = join(__dirname, "space.tar");
export const GNU_LONG_PATH = join(__dirname, "gnu-long-path.tar");
export const BASE_256_UID_GID = join(__dirname, "base-256-uid-gid.tar");
export const LARGE_UID_GID = join(__dirname, "large-uid-gid.tar");
export const BASE_256_SIZE = join(__dirname, "base-256-size.tar");
export const HUGE = join(__dirname, "huge.tar.gz");
export const LATIN1_TAR = join(__dirname, "latin1.tar");
export const INCOMPLETE_TAR = join(__dirname, "incomplete.tar");

// Created using gnu tar: tar cf gnu-incremental.tar --format gnu --owner=myuser:12345 --group=mygroup:67890 test.txt
export const GNU_TAR = join(__dirname, "gnu.tar");
// Created using gnu tar: tar cf gnu-incremental.tar -G --format gnu --owner=myuser:12345 --group=mygroup:67890 test.txt
export const GNU_INCREMENTAL_TAR = join(__dirname, "gnu-incremental.tar");
// Created from multi-file.tar, removing the magic and recomputing the checksum
export const UNKNOWN_FORMAT = join(__dirname, "unknown-format.tar");
// Created using gnu tar: tar cf v7.tar --format v7 test.txt
export const V7_TAR = join(__dirname, "v7.tar");
export const INVALID_TAR = join(__dirname, "invalid.tar");

// Real-world large packages for complex testing
export const LODASH_TGZ = join(__dirname, "lodash-4.17.21.tgz");
export const NEXT_SWC_TGZ = join(__dirname, "next-swc-linux-14.2.15.tgz");
export const SHARP_TGZ = join(__dirname, "sharp-0.33.5.tgz");
export const ELECTRON_TGZ = join(__dirname, "electron-33.0.2.tgz");
