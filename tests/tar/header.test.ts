import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { writeChecksum } from "../../src/tar/checksum";
import { TYPEFLAG, USTAR_TYPEFLAG_OFFSET } from "../../src/tar/constants";
import { createTarHeader, parseUstarHeader } from "../../src/tar/header";
import { unpackTar } from "../../src/web";
import { LONG_NAME_TAR, NAME_IS_100_TAR } from "../web/fixtures";

describe("USTAR headers", () => {
	it("preserves entry types and the file fallback for every type byte", () => {
		const block = createTarHeader({ name: "entry", size: 0 });
		for (let byte = 0; byte < 256; byte++) {
			block[USTAR_TYPEFLAG_OFFSET] = byte;
			writeChecksum(block);
			const expected =
				Object.entries(TYPEFLAG).find(
					([, flag]) => flag.charCodeAt(0) === byte,
				)?.[0] ?? "file";
			expect(parseUstarHeader(block, true).type, `type byte ${byte}`).toBe(
				expected,
			);
		}
	});

	it("round-trips supported header fields", () => {
		const mtime = new Date(1_700_000_000_000);
		const header = {
			name: "directory/file.txt",
			type: "file" as const,
			size: 123,
			mode: 0o640,
			uid: 1234,
			gid: 5678,
			mtime,
			uname: "user",
			gname: "group",
		};

		expect(parseUstarHeader(createTarHeader(header), true)).toMatchObject(
			header,
		);
	});

	it("forces bodyless entry sizes to zero", () => {
		const parsed = parseUstarHeader(
			createTarHeader({ name: "directory/", type: "directory", size: 512 }),
			true,
		);
		expect(parsed.size).toBe(0);
	});

	it("reads the exact 100-byte name boundary from an external fixture", async () => {
		const [entry] = await unpackTar(await readFile(NAME_IS_100_TAR));
		expect(entry.header.name).toBe(
			"node_modules/mocha-jshint/node_modules/jshint/node_modules/console-browserify/test/static/index.html",
		);
	});

	it("reconstructs a path split across USTAR prefix and name fields", async () => {
		const [entry] = await unpackTar(await readFile(LONG_NAME_TAR));
		expect(entry.header.name).toBe(
			"my/file/is/longer/than/100/characters/and/should/use/the/prefix/header/foobarbaz/foobarbaz/foobarbaz/foobarbaz/foobarbaz/foobarbaz/filename.txt",
		);
	});
});
