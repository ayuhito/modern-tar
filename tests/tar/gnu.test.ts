import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { writeChecksum } from "../../src/tar/checksum";
import { BLOCK_SIZE, USTAR_TYPEFLAG_OFFSET } from "../../src/tar/constants";
import { decoder, encoder } from "../../src/tar/encoding";
import { createTarHeader } from "../../src/tar/header";
import type { TarHeader } from "../../src/tar/types";
import { unpackTar } from "../../src/web";
import { GNU_INCREMENTAL_TAR, GNU_LONG_PATH, GNU_TAR } from "../web/fixtures";

const createGnuMetadataArchive = (
	type: "gnu-long-name" | "gnu-long-link-name",
	value: string,
	header: TarHeader,
	body = new Uint8Array(0),
): Uint8Array => {
	const metadata = encoder.encode(`${value}\0`);
	const metadataHeader = createTarHeader({
		name: "././@LongLink",
		type,
		size: metadata.length,
	});
	// GNU identifies itself with `ustar  ` and reuses USTAR prefix bytes for
	// timestamp metadata, so the parser must not join them to the file name.
	encoder.encodeInto("ustar  ", metadataHeader.subarray(257, 265));
	writeChecksum(metadataHeader);

	const metadataBlocks = Math.ceil(metadata.length / BLOCK_SIZE) * BLOCK_SIZE;
	const bodyBlocks = Math.ceil(body.length / BLOCK_SIZE) * BLOCK_SIZE;
	const archive = new Uint8Array(
		BLOCK_SIZE + metadataBlocks + BLOCK_SIZE + bodyBlocks + BLOCK_SIZE * 2,
	);
	archive.set(metadataHeader);
	archive.set(metadata, BLOCK_SIZE);
	archive.set(createTarHeader(header), BLOCK_SIZE + metadataBlocks);
	archive.set(body, BLOCK_SIZE + metadataBlocks + BLOCK_SIZE);
	return archive;
};

describe("GNU compatibility", () => {
	it.each([false, true])(
		"reads the external fixture with strict=%s",
		async (strict) => {
			const [entry] = await unpackTar(await readFile(GNU_TAR), { strict });

			expect(entry.header).toMatchObject({
				name: "test.txt",
				type: "file",
				size: 14,
				uid: 12345,
				gid: 67890,
				uname: "myuser",
				gname: "mygroup",
			});
			expect(decoder.decode(entry.data).trim()).toBe("Hello, world!");
		},
	);

	it("does not interpret GNU incremental prefix metadata as a path", async () => {
		const [entry] = await unpackTar(await readFile(GNU_INCREMENTAL_TAR), {
			strict: true,
		});

		expect(entry.header.name).toBe("test.txt");
		expect(entry.header.name).not.toContain("1347402");
	});

	it("reads an external GNU long-path fixture", async () => {
		const [entry] = await unpackTar(await readFile(GNU_LONG_PATH));
		expect(entry.header.name).toBe(
			"node-v0.11.14/deps/npm/node_modules/init-package-json/node_modules/promzard/example/npm-init/init-input.js",
		);
		expect(decoder.decode(entry.data)).toContain("module.exports");
	});

	it.each([
		["gnu-long-name", "name", `${"long/".repeat(30)}file.txt`],
		["gnu-long-link-name", "linkname", `${"target/".repeat(30)}file.txt`],
	] as const)(
		"applies %s metadata to the following entry",
		async (type, field, value) => {
			const symlink = field === "linkname";
			const body = symlink ? new Uint8Array(0) : encoder.encode("hello");
			const archive = createGnuMetadataArchive(
				type,
				value,
				{
					name: symlink ? "link" : "short.txt",
					type: symlink ? "symlink" : "file",
					linkname: symlink ? "short-target" : undefined,
					size: body.length,
				},
				body,
			);

			const [entry] = await unpackTar(archive);
			expect(entry.header[field]).toBe(value);
			if (!symlink) expect(decoder.decode(entry.data)).toBe("hello");
		},
	);

	it("treats unknown type flags as regular files", async () => {
		const header = createTarHeader({ name: "unknown", size: 1 });
		header[USTAR_TYPEFLAG_OFFSET] = "X".charCodeAt(0);
		writeChecksum(header);
		const next = createTarHeader({ name: "next.txt", size: 1 });
		const archive = new Uint8Array(BLOCK_SIZE * 6);
		archive.set(header);
		archive[BLOCK_SIZE] = "x".charCodeAt(0);
		archive.set(next, BLOCK_SIZE * 2);
		archive[BLOCK_SIZE * 3] = "y".charCodeAt(0);

		const entries = await unpackTar(archive, { strict: true });
		expect(
			entries.map(({ header: parsed, data }) => [
				parsed.name,
				parsed.type,
				decoder.decode(data),
			]),
		).toEqual([
			["unknown", "file", "x"],
			["next.txt", "file", "y"],
		]);
	});
});
