import * as fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BLOCK_SIZE } from "../../src/tar/constants";
import { decoder } from "../../src/tar/encoding";
import { createTarHeader } from "../../src/tar/header";

import { packTar, unpackTar } from "../../src/web";
import {
	INCOMPLETE_TAR,
	MULTI_FILE_TAR,
	ONE_FILE_TAR,
	TYPES_TAR,
} from "./fixtures";

describe("unpackTar", () => {
	it("extracts a single file tar", async () => {
		const buffer = await fs.readFile(ONE_FILE_TAR);
		const entries = await unpackTar(buffer);

		expect(entries).toHaveLength(1);
		const [entry] = entries;

		expect(entry.header.name).toBe("test.txt");
		expect(entry.header.size).toBe(12);
		expect(entry.header.type).toBe("file");
		expect(entry.header.mode).toBe(0o644);
		expect(entry.header.uid).toBe(501);
		expect(entry.header.gid).toBe(20);
		expect(entry.header.mtime).toEqual(new Date(1387580181000));
		expect(entry.header.uname).toBe("maf");
		expect(entry.header.gname).toBe("staff");
		expect(decoder.decode(entry.data)).toBe("hello world\n");
	});

	it("extracts a multi-file tar", async () => {
		const buffer = await fs.readFile(MULTI_FILE_TAR);
		const entries = await unpackTar(buffer);

		expect(entries).toHaveLength(2);
		expect(entries[0].header.name).toBe("file-1.txt");
		expect(decoder.decode(entries[0].data)).toBe("i am file-1\n");
		expect(entries[1].header.name).toBe("file-2.txt");
		expect(decoder.decode(entries[1].data)).toBe("i am file-2\n");
	});

	it("returns file data independent from the source archive buffer", async () => {
		const archive = await packTar([
			{ header: { name: "file.txt", type: "file", size: 5 }, body: "hello" },
		]);
		const [entry] = await unpackTar(archive);
		const data = entry.data;
		expect(data).toBeDefined();
		if (!data) throw new Error("Expected file data");

		data[0] = "x".charCodeAt(0);
		expect(archive[BLOCK_SIZE]).toBe("h".charCodeAt(0));

		archive[BLOCK_SIZE] = "y".charCodeAt(0);
		expect(data[0]).toBe("x".charCodeAt(0));
	});

	it("does not retain impossible file sizes for non-strict data", async () => {
		const archive = createTarHeader({
			name: "huge.bin",
			type: "file",
			size: 1024 * 1024,
		});
		const [entry] = await unpackTar(archive, { strict: false });

		expect(entry.data?.buffer.byteLength).toBe(0);

		const paxArchive = await packTar([
			{
				header: {
					name: "negative-pax-size.txt",
					type: "file",
					size: 1,
					pax: { size: "-1" },
				},
				body: "x",
			},
		]);
		const [paxEntry] = await unpackTar(paxArchive, { strict: false });

		expect(paxEntry.header.size).toBe(1);
		expect(decoder.decode(paxEntry.data)).toBe("x");
	});

	it("extracts a tar with various entry types (directory, symlink)", async () => {
		const buffer = await fs.readFile(TYPES_TAR);
		const entries = await unpackTar(buffer);

		expect(entries).toHaveLength(2);
		const [dir, link] = entries;

		expect(dir.header.name).toBe("directory");
		expect(dir.header.type).toBe("directory");
		expect(dir.header.size).toBe(0);

		expect(link.header.name).toBe("directory-link");
		expect(link.header.type).toBe("symlink");
		expect(link.header.linkname).toBe("directory");
	});

	it("throws an error for an incomplete archive in strict mode", async () => {
		const buffer = await fs.readFile(INCOMPLETE_TAR);
		await expect(unpackTar(buffer, { strict: true })).rejects.toThrow(
			"Tar archive is truncated.",
		);
	});

	it("handles an incomplete archive gracefully in non-strict mode", async () => {
		const buffer = await fs.readFile(INCOMPLETE_TAR);
		const entries = await unpackTar(buffer, { strict: false });

		expect(entries).toHaveLength(1);
		expect(entries[0].header.name).toBe("file-1.txt");
	});

	it("should ignore extra data after the final null blocks in non-strict mode", async () => {
		const archive = await packTar([
			{ header: { name: "test.txt", type: "file", size: 5 }, body: "hello" },
		]);
		const extraData = new Uint8Array([1, 2, 3]);
		const combined = new Uint8Array(archive.length + extraData.length);
		combined.set(archive);
		combined.set(extraData, archive.length);

		const entries = await unpackTar(combined, { strict: false });
		expect(entries).toHaveLength(1);
		expect(entries[0].header.name).toBe("test.txt");
	});
});
