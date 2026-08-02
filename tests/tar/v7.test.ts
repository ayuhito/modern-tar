import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { writeChecksum } from "../../src/tar/checksum";
import {
	BLOCK_SIZE,
	FILE,
	LINK,
	USTAR_MAGIC_OFFSET,
	USTAR_MAGIC_SIZE,
	USTAR_SIZE_OFFSET,
	USTAR_SIZE_SIZE,
	USTAR_VERSION_OFFSET,
	USTAR_VERSION_SIZE,
} from "../../src/tar/constants";
import { decoder, writeOctal } from "../../src/tar/encoding";
import { createTarHeader } from "../../src/tar/header";
import { unpackTar } from "../../src/web";
import { V7_TAR } from "../web/fixtures";

describe("V7 compatibility", () => {
	it.each([false, true])(
		"reads the external fixture with strict=%s",
		async (strict) => {
			const [entry] = await unpackTar(await readFile(V7_TAR), { strict });

			expect(entry.header).toMatchObject({
				name: "test.txt",
				type: "file",
				size: 14,
			});
			expect(entry.header.uname).toBeUndefined();
			expect(entry.header.gname).toBeUndefined();
			expect(decoder.decode(entry.data).trim()).toBe("Hello, world!");
		},
	);

	it("ignores encoded sizes for bodyless V7 links", async () => {
		const link = createTarHeader({
			name: "link-entry",
			size: 0,
			type: LINK,
			linkname: "target",
		});
		writeOctal(link, USTAR_SIZE_OFFSET, USTAR_SIZE_SIZE, BLOCK_SIZE);
		link.fill(0, USTAR_MAGIC_OFFSET, USTAR_MAGIC_OFFSET + USTAR_MAGIC_SIZE);
		link.fill(
			0,
			USTAR_VERSION_OFFSET,
			USTAR_VERSION_OFFSET + USTAR_VERSION_SIZE,
		);
		writeChecksum(link);

		const next = createTarHeader({ name: "next.txt", type: FILE, size: 1 });
		next.fill(0, USTAR_MAGIC_OFFSET, USTAR_MAGIC_OFFSET + USTAR_MAGIC_SIZE);
		next.fill(
			0,
			USTAR_VERSION_OFFSET,
			USTAR_VERSION_OFFSET + USTAR_VERSION_SIZE,
		);
		writeChecksum(next);
		const archive = new Uint8Array(BLOCK_SIZE * 5);
		archive.set(link);
		archive.set(next, BLOCK_SIZE);
		archive[BLOCK_SIZE * 2] = "x".charCodeAt(0);

		const entries = await unpackTar(archive, { strict: true });
		expect(entries.map(({ header }) => [header.name, header.size])).toEqual([
			["link-entry", 0],
			["next.txt", 1],
		]);
	});
});
