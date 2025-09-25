import * as fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { packTar } from "../../src/web";
import { unpackTar } from "../../src/web/index";
import { createTarDecoder } from "../../src/web/stream";
import { decoder } from "../../src/web/utils";
import {
	GNU_TAR,
	INCOMPLETE_TAR,
	LONG_NAME_TAR,
	MULTI_FILE_TAR,
	ONE_FILE_TAR,
	PAX_TAR,
	TYPES_TAR,
	UNICODE_TAR,
} from "./fixtures";

describe("extract", () => {
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
		expect(entries[0].header.size).toBe(12);
		expect(decoder.decode(entries[0].data)).toBe("i am file-1\n");

		expect(entries[1].header.name).toBe("file-2.txt");
		expect(entries[1].header.size).toBe(12);
		expect(decoder.decode(entries[1].data)).toBe("i am file-2\n");
	});

	it("extracts a tar with various types (directory, symlink)", async () => {
		const buffer = await fs.readFile(TYPES_TAR);
		const entries = await unpackTar(buffer);

		expect(entries).toHaveLength(2);

		const [dir, link] = entries;

		expect(dir.header.name).toBe("directory");
		expect(dir.header.type).toBe("directory");
		expect(dir.header.size).toBe(0);
		expect(dir.header.mode).toBe(0o755);

		expect(link.header.name).toBe("directory-link");
		expect(link.header.type).toBe("symlink");
		expect(link.header.linkname).toBe("directory");
		expect(link.header.size).toBe(0);
	});

	it("extracts a tar with a long name (USTAR prefix)", async () => {
		const buffer = await fs.readFile(LONG_NAME_TAR);
		const entries = await unpackTar(buffer);
		expect(entries).toHaveLength(1);

		// The parser should now combine the 'prefix' and 'name' fields.
		const expectedName =
			"my/file/is/longer/than/100/characters/and/should/use/the/prefix/header/foobarbaz/foobarbaz/foobarbaz/foobarbaz/foobarbaz/foobarbaz/filename.txt";
		expect(entries[0].header.name).toBe(expectedName);
		expect(decoder.decode(entries[0].data)).toBe("hello long name\n");
	});

	it("extracts a tar with unicode name (PAX header)", async () => {
		const buffer = await fs.readFile(UNICODE_TAR);
		const entries = await unpackTar(buffer);

		expect(entries).toHaveLength(1);
		const [entry] = entries;

		// The name is now correctly parsed from the PAX header
		expect(entry.header.name).toBe("høstål.txt");
		// We can also assert that the PAX data was parsed correctly
		expect(entry.header.pax).toEqual({ path: "høstål.txt" });
		expect(decoder.decode(entry.data)).toBe("høllø\n");
	});

	// New test to verify PAX attribute parsing
	it("extracts a tar with PAX headers", async () => {
		const buffer = await fs.readFile(PAX_TAR);
		const entries = await unpackTar(buffer);

		expect(entries).toHaveLength(1);
		const [entry] = entries;

		expect(entry.header.name).toBe("pax.txt");
		expect(entry.header.pax).toEqual({
			path: "pax.txt",
			special: "sauce",
		});
		expect(decoder.decode(entry.data)).toBe("hello world\n");
	});

	it("extracts a filename that is exactly 100 characters long", async () => {
		// Create the expected 100-character filename
		const longName =
			"0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789";
		expect(longName.length).toBe(100);

		// Create a test archive with the 100-character filename using our pack function
		const testArchive = await packTar([
			{
				header: {
					name: longName,
					size: 6,
					type: "file",
					mode: 0o644,
					mtime: new Date(1387580181000),
					uname: "maf",
					gname: "staff",
					uid: 501,
					gid: 20,
				},
				body: "hello\n",
			},
		]);

		// Now extract and verify
		const entries = await unpackTar(testArchive);

		expect(entries).toHaveLength(1);
		expect(entries[0].header.name).toHaveLength(100);
		expect(entries[0].header.name).toBe(longName);
		expect(decoder.decode(entries[0].data)).toBe("hello\n");
	});

	it("extracts a gnu format tar", async () => {
		const buffer = await fs.readFile(GNU_TAR);
		const entries = await unpackTar(buffer);

		expect(entries).toHaveLength(1);
		const [entry] = entries;

		expect(entry.header.name).toBe("test.txt");
		expect(entry.header.size).toBe(14);
		expect(entry.header.uid).toBe(12345);
		expect(entry.header.gid).toBe(67890);
		expect(entry.header.uname).toBe("myuser");
		expect(entry.header.gname).toBe("mygroup");
		expect(decoder.decode(entry.data)).toBe("Hello, world!\n");
	});

	it("throws an error for an incomplete archive", async () => {
		const buffer = await fs.readFile(INCOMPLETE_TAR);

		// We expect unpackTar to reject because the archive is truncated
		await expect(unpackTar(buffer)).rejects.toThrow(
			"Tar archive is truncated.",
		);
	});

	it("extracts a tar with a huge file using PAX headers for size", async () => {
		const hugeFileSize = "8804630528"; // ~8.2 GB, as a string
		const smallBody = "this is a placeholder body";
		const bodyBuffer = new TextEncoder().encode(smallBody);

		const archive = await packTar([
			{
				header: {
					name: "huge.txt",
					mode: 0o644,
					mtime: new Date(1521214967000),
					size: bodyBuffer.length, // The USTAR size can be the actual body size for this test
					pax: {
						size: hugeFileSize,
					},
				},
				body: bodyBuffer,
			},
		]);

		// Use streaming API to test just the header parsing without reading full body
		// @ts-expect-error ReadableStream.from is supported.
		const sourceStream = ReadableStream.from([archive]);
		const decoder = new TextDecoder();

		let headerParsed = false;
		let entry: {
			header: { name: string; size: number };
			body: ReadableStream<Uint8Array>;
		} | null = null;

		const entryStream = sourceStream.pipeThrough(createTarDecoder());
		const reader = entryStream.getReader();

		try {
			const result = await reader.read();
			if (!result.done) {
				entry = result.value;
				headerParsed = true;
			}
		} catch {
			// Expected for huge file simulation
		} finally {
			reader.releaseLock();
		}

		expect(headerParsed).toBe(true);
		expect(entry).not.toBeNull();

		if (entry) {
			expect(entry.header.name).toBe("huge.txt");
			// Verify that the size was correctly parsed from the PAX header
			expect(entry.header.size).toBe(Number.parseInt(hugeFileSize, 10));

			// Read just a small portion of the body to verify it starts correctly
			const bodyReader = entry.body.getReader();
			const chunk = await bodyReader.read();
			const partialContent = decoder.decode(chunk.value);
			// Trim null bytes that are part of TAR padding
			expect(partialContent.replace(/\0+$/, "")).toBe(smallBody);
			bodyReader.releaseLock();
		}
	});
});
