import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureNames } from "./manifest";

const directory = dirname(fileURLToPath(import.meta.url));
const fixturePath = (name: string) => join(directory, name);

// Copied from https://github.com/mafintosh/tar-stream/tree/master/test/fixtures
export const ONE_FILE_TAR = fixturePath(fixtureNames.oneFile);
export const MULTI_FILE_TAR = fixturePath(fixtureNames.multiFile);
export const PAX_TAR = fixturePath(fixtureNames.pax);
export const TYPES_TAR = fixturePath(fixtureNames.types);
export const LONG_NAME_TAR = fixturePath(fixtureNames.longName);
export const UNICODE_BSD_TAR = fixturePath(fixtureNames.unicodeBsd);
export const UNICODE_TAR = fixturePath(fixtureNames.unicode);
export const NAME_IS_100_TAR = fixturePath(fixtureNames.nameIs100);
export const INVALID_TGZ = fixturePath(fixtureNames.invalidTgz);
export const SPACE_TAR_GZ = fixturePath(fixtureNames.space);
export const GNU_LONG_PATH = fixturePath(fixtureNames.gnuLongPath);
export const BASE_256_UID_GID = fixturePath(fixtureNames.base256UidGid);
export const LARGE_UID_GID = fixturePath(fixtureNames.largeUidGid);
export const BASE_256_SIZE = fixturePath(fixtureNames.base256Size);
export const HUGE = fixturePath(fixtureNames.huge);
export const LATIN1_TAR = fixturePath(fixtureNames.latin1);
export const INCOMPLETE_TAR = fixturePath(fixtureNames.incomplete);

// Created using gnu tar: tar cf gnu-incremental.tar --format gnu --owner=myuser:12345 --group=mygroup:67890 test.txt
export const GNU_TAR = fixturePath(fixtureNames.gnu);
// Created using gnu tar: tar cf gnu-incremental.tar -G --format gnu --owner=myuser:12345 --group=mygroup:67890 test.txt
export const GNU_INCREMENTAL_TAR = fixturePath(fixtureNames.gnuIncremental);
// Created from multi-file.tar, removing the magic and recomputing the checksum
export const UNKNOWN_FORMAT = fixturePath(fixtureNames.unknownFormat);
// Created using gnu tar: tar cf v7.tar --format v7 test.txt
export const V7_TAR = fixturePath(fixtureNames.v7);
export const INVALID_TAR = fixturePath(fixtureNames.invalidTar);

// Real-world large packages for complex testing
export const LODASH_TGZ = fixturePath(fixtureNames.lodash);
export const NEXT_SWC_TGZ = fixturePath(fixtureNames.nextSwc);
export const SHARP_TGZ = fixturePath(fixtureNames.sharp);
export const ELECTRON_TGZ = fixturePath(fixtureNames.electron);
export const NODE_V25_DARWIN_ARM64_TAR_GZ = fixturePath(
	fixtureNames.nodeDarwinArm64,
);
export const TSGO_WASM_TGZ = fixturePath(fixtureNames.tsgoWasm);
