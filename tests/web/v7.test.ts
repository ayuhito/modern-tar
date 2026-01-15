import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
	BLOCK_SIZE,
	FILE,
	LINK,
	USTAR_SIZE_OFFSET,
	USTAR_SIZE_SIZE,
} from "../../src/tar/constants";
import { decoder, writeOctal } from "../../src/tar/encoding";
import { createTarHeader } from "../../src/tar/header";
import { unpackTar } from "../../src/web";
import { V7_TAR } from "./fixtures";

describe("V7 tar format support", () => {
	describe("basic V7 format", () => {
		it("extracts a V7 format tar archive", async () => {
			const buffer = await readFile(V7_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			expect(entry.header.name).toBe("test.txt");
			expect(entry.header.type).toBe("file");
			expect(decoder.decode(entry.data).trim()).toBe("Hello, world!");
		});

		it("works in both strict and non-strict modes", async () => {
			const buffer = await readFile(V7_TAR);
			const entries = await unpackTar(buffer);
			const entriesStrict = await unpackTar(buffer, { strict: true });

			// Both modes should work identically for V7
			expect(entries).toHaveLength(1);
			expect(entriesStrict).toHaveLength(1);

			const [entry] = entries;
			const [entryStrict] = entriesStrict;

			expect(entry.header.name).toBe("test.txt");
			expect(entryStrict.header.name).toBe("test.txt");
			expect(entry.header.type).toBe("file");
			expect(entryStrict.header.type).toBe("file");

			// V7 format has basic POSIX metadata
			expect(entry.header.size).toBe(14);
			expect(entryStrict.header.size).toBe(14);
			expect(entry.header.mtime).toBeInstanceOf(Date);
			expect(entryStrict.header.mtime).toBeInstanceOf(Date);

			// Should not have USTAR fields in V7 format
			expect(entry.header.uname).toBeUndefined();
			expect(entryStrict.header.uname).toBeUndefined();
			expect(entry.header.gname).toBeUndefined();
			expect(entryStrict.header.gname).toBeUndefined();

			expect(decoder.decode(entry.data).trim()).toBe("Hello, world!");
			expect(decoder.decode(entryStrict.data).trim()).toBe("Hello, world!");
		});

		it("does not have USTAR-specific fields in V7 format", async () => {
			const buffer = await readFile(V7_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			// V7 format should not have USTAR fields
			expect(entry.header.uname).toBeUndefined();
			expect(entry.header.gname).toBeUndefined();
			// But basic fields should work
			expect(entry.header.name).toBe("test.txt");
			expect(entry.header.type).toBe("file");
			expect(entry.header.mode).toBeGreaterThan(0);
			expect(entry.header.uid).toBeGreaterThanOrEqual(0);
			expect(entry.header.gid).toBeGreaterThanOrEqual(0);
		});

		it("handles V7 format metadata correctly", async () => {
			const buffer = await readFile(V7_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			// V7 format has basic POSIX metadata
			expect(entry.header.size).toBe(14);
			expect(entry.header.mtime).toBeInstanceOf(Date);
			expect(entry.header.mtime?.getTime()).toBeGreaterThan(0);
		});
	});

	describe("V7 format characteristics", () => {
		it("has no magic field (pre-USTAR)", async () => {
			const buffer = await readFile(V7_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			// V7 predates USTAR, so no magic/version fields
			expect(entry.header.uname).toBeUndefined();
			expect(entry.header.gname).toBeUndefined();
			// No prefix field support
			expect(entry.header.name.length).toBeLessThanOrEqual(100);
		});

		it("supports basic file types", async () => {
			const buffer = await readFile(V7_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			// V7 supports basic file types
			expect(["file", "directory", "symlink", "link"]).toContain(
				entry.header.type,
			);
			expect(entry.header.type).toBe("file");
		});

		it("maintains backward compatibility with modern readers", async () => {
			// This test verifies that V7 format works seamlessly
			const buffer = await readFile(V7_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			expect(entries[0].header.name).toBe("test.txt");
			expect(decoder.decode(entries[0].data).trim()).toBe("Hello, world!");
		});
	});

	describe("V7 format limitations", () => {
		it("has limited filename length (100 characters)", async () => {
			const buffer = await readFile(V7_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			// V7 format is limited to 100-character filenames
			expect(entry.header.name.length).toBeLessThanOrEqual(100);
			expect(entry.header.name).toBe("test.txt");
		});

		it("does not support prefix field for long names", async () => {
			const buffer = await readFile(V7_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			// V7 has no prefix support - long names would be truncated
			// This archive has a short name, so no issues
			expect(entry.header.name).toBe("test.txt");
		});

		it("does not support user/group names", async () => {
			const buffer = await readFile(V7_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			// V7 only has numeric uid/gid, no text names
			expect(entry.header.uname).toBeUndefined();
			expect(entry.header.gname).toBeUndefined();
			expect(typeof entry.header.uid).toBe("number");
			expect(typeof entry.header.gid).toBe("number");
		});
	});

	describe("compatibility with modern features", () => {
		it("can be processed with modern options", async () => {
			const buffer = await readFile(V7_TAR);

			// Test with various modern options
			const entriesWithFilter = await unpackTar(buffer, {
				filter: (header) => header.name.endsWith(".txt"),
			});
			expect(entriesWithFilter).toHaveLength(1);

			const entriesWithMap = await unpackTar(buffer, {
				map: (header) => ({ ...header, name: `v7-${header.name}` }),
			});
			expect(entriesWithMap[0].header.name).toBe("v7-test.txt");
		});

		it("integrates well with error handling", async () => {
			const buffer = await readFile(V7_TAR);

			// Should handle V7 format gracefully even with strict checks
			const entries = await unpackTar(buffer, {
				strict: true,
				filter: () => true, // Accept all entries
			});

			expect(entries).toHaveLength(1);
			expect(entries[0].header.type).toBe("file");
		});
	});

	describe("V7 format edge cases", () => {
		it("ignores size field for link entries (V7 compatibility)", async () => {
			const linkHeader = createTarHeader({
				name: "link-entry",
				type: LINK,
				linkname: "target",
				size: 0,
				mode: 0o644,
				uid: 1000,
				gid: 1000,
				mtime: new Date(),
			});

			// Simulate V7 behavior where links might have a non-zero size
			writeOctal(linkHeader, USTAR_SIZE_OFFSET, USTAR_SIZE_SIZE, 512);

			const fileHeader = createTarHeader({
				name: "next-file.txt",
				type: FILE,
				size: 11,
				mode: 0o644,
				uid: 1000,
				gid: 1000,
				mtime: new Date(),
			});

			const fileData = new Uint8Array(BLOCK_SIZE);
			fileData.set(new TextEncoder().encode("Hello World"));

			// archive: [Link Header (bad size)] [File Header] [File Body] [EOF]
			const archive = new Uint8Array(BLOCK_SIZE * 5);
			archive.set(linkHeader, 0);
			archive.set(fileHeader, BLOCK_SIZE);
			archive.set(fileData, BLOCK_SIZE * 2);

			const entries = await unpackTar(archive);

			expect(entries).toHaveLength(2);
			const [linkEntry, fileEntry] = entries;

			expect(linkEntry.header.name).toBe("link-entry");
			expect(linkEntry.header.type).toBe(LINK);
			expect(linkEntry.header.size).toBe(0);

			expect(fileEntry.header.name).toBe("next-file.txt");
			expect(new TextDecoder().decode(fileEntry.data).trim()).toBe("Hello World");
		});
	});
});
