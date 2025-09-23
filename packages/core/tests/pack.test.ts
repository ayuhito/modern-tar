import { describe, expect, it } from "vitest";
import { packTar, type TarEntry, unpackTar } from "../src/index";
import { decoder } from "../src/utils";

describe("pack", () => {
	it("packs a single file", async () => {
		const entries: TarEntry[] = [
			{
				header: {
					name: "test.txt",
					mtime: new Date(1387580181000),
					mode: 0o644,
					uname: "maf",
					gname: "staff",
					uid: 501,
					gid: 20,
					size: 12,
				},
				body: "hello world\n",
			},
		];

		const packedBuffer = await packTar(entries);

		// Verify the archive can be extracted correctly (round-trip test)
		const extracted = await unpackTar(packedBuffer);
		expect(extracted).toHaveLength(1);
		expect(extracted[0].header.name).toBe("test.txt");
		expect(extracted[0].header.size).toBe(12);
		expect(extracted[0].header.mode).toBe(0o644);
		expect(extracted[0].header.uid).toBe(501);
		expect(extracted[0].header.gid).toBe(20);
		expect(extracted[0].header.uname).toBe("maf");
		expect(extracted[0].header.gname).toBe("staff");
		expect(decoder.decode(extracted[0].data)).toBe("hello world\n");
	});

	it("packs multiple files", async () => {
		const entries: TarEntry[] = [
			{
				header: {
					name: "file-1.txt",
					mtime: new Date(1387580181000),
					mode: 0o644,
					uname: "maf",
					gname: "staff",
					uid: 501,
					gid: 20,
					size: 12,
				},
				body: "i am file-1\n",
			},
			{
				header: {
					name: "file-2.txt",
					mtime: new Date(1387580181000),
					mode: 0o644,
					uname: "maf",
					gname: "staff",
					uid: 501,
					gid: 20,
					size: 12,
				},
				body: "i am file-2\n",
			},
		];

		const packedBuffer = await packTar(entries);

		// Verify the archive can be extracted correctly (round-trip test)
		const extracted = await unpackTar(packedBuffer);
		expect(extracted).toHaveLength(2);

		expect(extracted[0].header.name).toBe("file-1.txt");
		expect(extracted[0].header.size).toBe(12);
		expect(decoder.decode(extracted[0].data)).toBe("i am file-1\n");

		expect(extracted[1].header.name).toBe("file-2.txt");
		expect(extracted[1].header.size).toBe(12);
		expect(decoder.decode(extracted[1].data)).toBe("i am file-2\n");
	});

	it("packs different types (directory, symlink)", async () => {
		const entries: TarEntry[] = [
			{
				header: {
					name: "directory",
					mtime: new Date(1387580181000),
					type: "directory",
					mode: 0o755,
					uname: "maf",
					gname: "staff",
					uid: 501,
					gid: 20,
					size: 0,
				},
			},
			{
				header: {
					name: "directory-link",
					mtime: new Date(1387580181000),
					type: "symlink",
					linkname: "directory",
					mode: 0o755,
					uname: "maf",
					gname: "staff",
					uid: 501,
					gid: 20,
					size: 0,
				},
			},
		];

		const packedBuffer = await packTar(entries);

		// Verify the archive can be extracted correctly (round-trip test)
		const extracted = await unpackTar(packedBuffer);
		expect(extracted).toHaveLength(2);

		expect(extracted[0].header.name).toBe("directory");
		expect(extracted[0].header.type).toBe("directory");
		expect(extracted[0].header.mode).toBe(0o755);

		expect(extracted[1].header.name).toBe("directory-link");
		expect(extracted[1].header.type).toBe("symlink");
		expect(extracted[1].header.linkname).toBe("directory");
	});

	it("packs a filename that is exactly 100 characters long", async () => {
		const longName =
			"0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789";
		expect(longName.length).toBe(100);

		const entries: TarEntry[] = [
			{
				header: {
					name: longName,
					mtime: new Date(1387580181000), // Match fixture mtime
					mode: 0o644,
					uname: "maf",
					gname: "staff",
					uid: 501,
					gid: 20,
					size: 6,
				},
				body: "hello\n",
			},
		];

		const packedBuffer = await packTar(entries);

		// Verify the archive can be extracted correctly (round-trip test)
		const extracted = await unpackTar(packedBuffer);
		expect(extracted).toHaveLength(1);
		expect(extracted[0].header.name).toBe(longName);
		expect(extracted[0].header.size).toBe(6);
		expect(decoder.decode(extracted[0].data)).toBe("hello\n");
	});

	it("handles USTAR long filenames by splitting into prefix and name", async () => {
		const longName =
			"a-very-long-directory-name/that-is-over-100-characters-long/and-needs-to-be-split-between-the-prefix-and-name-fields/file.txt";
		const expectedPrefix =
			"a-very-long-directory-name/that-is-over-100-characters-long/and-needs-to-be-split-between-the-prefix-and-name-fields";
		const expectedName = "file.txt";

		expect(longName.length).toBeGreaterThan(100);
		expect(expectedPrefix.length).toBeLessThanOrEqual(155);
		expect(expectedName.length).toBeLessThanOrEqual(100);

		const entries: TarEntry[] = [
			{
				header: { name: longName, size: 4 },
				body: "test",
			},
		];

		const packedBuffer = await packTar(entries);
		const headerBlock = packedBuffer.slice(0, 512);

		// Manually decode the name and prefix from the header block to verify the split.
		const nameField = decoder.decode(
			headerBlock.slice(0, 100).filter((b) => b !== 0),
		);
		const prefixField = decoder.decode(
			headerBlock.slice(345, 345 + 155).filter((b) => b !== 0),
		);

		expect(nameField).toBe(expectedName);
		expect(prefixField).toBe(expectedPrefix);

		// Also do a round-trip to be sure it extracts correctly.
		const [extracted] = await unpackTar(packedBuffer);
		expect(extracted.header.name).toBe(longName);
	});

	it("packs and then extracts successfully (round-trip)", async () => {
		const originalEntries: TarEntry[] = [
			{
				header: {
					name: "a/b/c.txt",
					size: 11,
					type: "file",
					mode: 0o644,
					mtime: new Date("2025-09-23T04:55:00.000Z"),
				},
				body: "hello world",
			},
			{
				header: {
					name: "a/b/",
					type: "directory",
					mode: 0o755,
					size: 0,
					mtime: new Date("2025-09-23T04:55:00.000Z"),
				},
			},
		];

		const packedBuffer = await packTar(originalEntries);
		const extractedEntries = await unpackTar(packedBuffer);

		expect(extractedEntries).toHaveLength(2);

		// File entry checks
		expect(extractedEntries[0].header.name).toBe("a/b/c.txt");
		expect(extractedEntries[0].header.size).toBe(11);
		expect(extractedEntries[0].header.type).toBe("file");
		expect(extractedEntries[0].header.mode).toBe(0o644);
		expect(extractedEntries[0].header.mtime).toEqual(
			new Date("2025-09-23T04:55:00.000Z"),
		);
		expect(decoder.decode(extractedEntries[0].data)).toBe("hello world");

		// Directory entry checks
		expect(extractedEntries[1].header.name).toBe("a/b/");
		expect(extractedEntries[1].header.size).toBe(0);
		expect(extractedEntries[1].header.type).toBe("directory");
		expect(extractedEntries[1].header.mode).toBe(0o755);
	});
});
