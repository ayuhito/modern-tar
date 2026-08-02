import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
	BLOCK_SIZE,
	USTAR_MAX_SIZE,
	USTAR_MAX_UID_GID,
} from "../../src/tar/constants";
import { decoder, encoder } from "../../src/tar/encoding";
import {
	applyOverrides,
	createTarHeader,
	parsePax,
} from "../../src/tar/header";
import { generatePax } from "../../src/tar/pax";
import { createUnpacker } from "../../src/tar/unpacker";
import { packTar, unpackTar } from "../../src/web";
import { PAX_TAR, UNICODE_TAR } from "../web/fixtures";

describe("PAX format", () => {
	it("reads external PAX fixtures", async () => {
		const [unicode] = await unpackTar(await readFile(UNICODE_TAR));
		expect(unicode.header).toMatchObject({
			name: "høstål.txt",
			pax: { path: "høstål.txt" },
		});
		expect(decoder.decode(unicode.data)).toBe("høllø\n");

		const [custom] = await unpackTar(await readFile(PAX_TAR));
		expect(custom.header).toMatchObject({
			name: "pax.txt",
			pax: { path: "pax.txt", special: "sauce" },
		});
	});

	it.each([
		["name", "가".repeat(33), false],
		["name", "가".repeat(34), true],
		["linkname", "가".repeat(33), false],
		["linkname", "가".repeat(34), true],
	] as const)(
		"selects PAX for %s values by UTF-8 bytes",
		(field, value, expected) => {
			const generated = generatePax({ name: "entry", [field]: value });
			expect(generated !== null).toBe(expected);
		},
	);

	it("preserves fields that exceed USTAR limits", async () => {
		const name = "x".repeat(101);
		const linkname = "target=".padEnd(101, "x");
		const uname = "u".repeat(33);
		const gname = "g".repeat(33);
		const uid = USTAR_MAX_UID_GID + 1;
		const [entry] = await unpackTar(
			await packTar([
				{
					header: {
						name,
						type: "symlink",
						linkname,
						uname,
						gname,
						uid,
						pax: { comment: "custom" },
					},
				},
			]),
		);

		expect(entry.header).toMatchObject({ name, linkname, uname, gname, uid });
		expect(entry.header.pax).toMatchObject({
			path: name,
			linkpath: linkname,
			uname,
			gname,
			uid: String(uid),
			comment: "custom",
		});
	});

	it("keeps bodyless entries aligned when PAX supplies a size", async () => {
		const entries = await unpackTar(
			await packTar([
				{
					header: {
						name: "link",
						type: "symlink",
						linkname: "target",
						pax: { size: String(BLOCK_SIZE) },
					},
				},
				{ header: { name: "next.txt", size: 1 }, body: "x" },
			]),
		);

		expect(entries.map(({ header }) => [header.name, header.size])).toEqual([
			["link", 0],
			["next.txt", 1],
		]);
	});

	it("does not carry local PAX size through GNU metadata", async () => {
		const paxArchive = await packTar([
			{
				header: {
					name: "ignored",
					size: 0,
					pax: { size: String(BLOCK_SIZE) },
				},
			},
		]);
		const longName = `${"long/".repeat(20)}file.txt`;
		const longNameBytes = encoder.encode(`${longName}\0`);
		const longNameBlock = new Uint8Array(BLOCK_SIZE);
		longNameBlock.set(longNameBytes);
		const gnuHeader = createTarHeader({
			name: "././@LongLink",
			type: "gnu-long-name",
			size: longNameBytes.length,
		});
		const fileArchive = await packTar([
			{ header: { name: "short.txt", size: 5 }, body: "hello" },
		]);
		const archive = new Uint8Array(BLOCK_SIZE * 4 + fileArchive.length);
		archive.set(paxArchive.subarray(0, BLOCK_SIZE * 2));
		archive.set(gnuHeader, BLOCK_SIZE * 2);
		archive.set(longNameBlock, BLOCK_SIZE * 3);
		archive.set(fileArchive, BLOCK_SIZE * 4);

		const [entry] = await unpackTar(archive);
		expect(entry.header).toMatchObject({ name: longName, size: 5 });
		expect(decoder.decode(entry.data)).toBe("hello");
	});

	it("parses empty and newline-containing custom values", async () => {
		const [entry] = await unpackTar(
			await packTar([
				{
					header: {
						name: "custom.txt",
						size: 1,
						pax: { empty: "", comment: "line one\nline two\t🚀" },
					},
					body: "x",
				},
			]),
		);

		expect(entry.header.pax).toMatchObject({
			empty: "",
			comment: "line one\nline two\t🚀",
		});
	});

	it("maps numeric PAX overrides onto a header", () => {
		const size = USTAR_MAX_SIZE + 1;
		const gid = USTAR_MAX_UID_GID + 1;
		const generated = generatePax({
			name: "large.bin",
			size,
			gid,
			pax: { mtime: "12345.678" },
		});
		expect(generated).not.toBeNull();
		if (!generated) throw new Error("Expected PAX data");

		const header = { name: "large.bin", size: 0 };
		applyOverrides(header, parsePax(generated.paxBody));

		expect(header).toMatchObject({
			size,
			gid,
			mtime: new Date(12345.678 * 1000),
		});
	});

	it("applies global PAX records to following entries", async () => {
		const paxBody = encoder.encode("18 comment=global\n");
		const globalHeader = createTarHeader({
			name: "GlobalHead",
			type: "pax-global-header",
			size: paxBody.length,
		});
		const fileArchive = await packTar([
			{ header: { name: "file.txt", size: 1 }, body: "x" },
		]);
		const archive = new Uint8Array(BLOCK_SIZE * 2 + fileArchive.length);
		archive.set(globalHeader);
		archive.set(paxBody, BLOCK_SIZE);
		archive.set(fileArchive, BLOCK_SIZE * 2);

		const [entry] = await unpackTar(archive);
		expect(entry.header.pax?.comment).toBe("global");
	});

	it("stops parsing invalid record lengths", () => {
		expect(parsePax(encoder.encode("-100 path=value\n"))).toEqual({});
	});

	it("rejects metadata bodies above the parser limit", () => {
		for (const strict of [false, true]) {
			const unpacker = createUnpacker({ strict });
			unpacker.write(
				createTarHeader({
					name: "meta",
					type: "pax-header",
					size: 8 * 1024 * 1024 + 1,
				}),
			);
			expect(() => unpacker.readHeader()).toThrow(
				"Tar metadata entry exceeds maximum size",
			);
		}
	});
});
