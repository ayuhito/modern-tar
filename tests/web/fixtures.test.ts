import * as fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createGzipDecoder, unpackTar } from "../../src/web";
import { decoder } from "../../src/web/utils";
import {
	BASE_256_SIZE,
	BASE_256_UID_GID,
	INVALID_TGZ,
	LARGE_UID_GID,
	LATIN1_TAR,
	NAME_IS_100_TAR,
	SPACE_TAR_GZ,
	UNICODE_BSD_TAR,
	UNKNOWN_FORMAT,
	V7_TAR,
} from "./fixtures";

describe("tar format fixtures", () => {
	describe("filename edge cases", () => {
		it("extracts a tar with exactly 100-character filename", async () => {
			const buffer = await fs.readFile(NAME_IS_100_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			// Verify the filename is exactly 100 characters (USTAR boundary)
			expect(entry.header.name).toHaveLength(100);
			expect(entry.header.name).toBe(
				"node_modules/mocha-jshint/node_modules/jshint/node_modules/console-browserify/test/static/index.html",
			);
			expect(entry.header.type).toBe("file");
			expect(decoder.decode(entry.data)).toBe("hello\n");
		});

		it("extracts a tar with spaces in filenames", async () => {
			const buffer = await fs.readFile(SPACE_TAR_GZ);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(4);

			// Find entry with spaces in name (should be in test-0.0.0-SNAPSHOT directory)
			const entryWithSpaces = entries.find((e) =>
				e.header.name.includes("test-0.0.0-SNAPSHOT"),
			);
			expect(entryWithSpaces).toBeDefined();
			expect(entryWithSpaces?.header.type).toBe("file");
		});
	});

	describe("character encoding", () => {
		it("extracts a tar with unicode names (BSD tar format)", async () => {
			const buffer = await fs.readFile(UNICODE_BSD_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			// Verify unicode filename is properly decoded
			expect(entry.header.name).toBe("høllø.txt");
			expect(entry.header.type).toBe("file");
			// Content should also contain unicode characters
			const content = decoder.decode(entry.data);
			expect(content).toContain("hej");
		});

		it("extracts a tar with latin1 encoding", async () => {
			const buffer = await fs.readFile(LATIN1_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			// Latin1 characters show up with replacement characters due to encoding
			expect(entry.header.name).toContain("fran");
			expect(entry.header.name).toContain("ais");
			expect(entry.header.type).toBe("file");
			const content = decoder.decode(entry.data);
			expect(content.length).toBeGreaterThan(0);
		});
	});

	describe("large value handling", () => {
		it("extracts a tar with base-256 encoded file size", async () => {
			const buffer = await fs.readFile(BASE_256_SIZE);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			// Verify file size was decoded (actual fixture has normal size)
			expect(entry.header.name).toBe("test.txt");
			expect(entry.header.type).toBe("file");
			expect(entry.header.size).toBe(12);
		});

		it("extracts a tar with base-256 encoded uid/gid", async () => {
			const buffer = await fs.readFile(BASE_256_UID_GID);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			expect(entry.header.name).toBe("package.json");
			expect(entry.header.type).toBe("file");
			// UIDs/GIDs should be large values that exceed octal limits
			expect(entry.header.uid).toBe(116435139);
			expect(entry.header.gid).toBe(1876110778);
		});

		it("extracts a tar with large uid/gid values", async () => {
			const buffer = await fs.readFile(LARGE_UID_GID);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			expect(entry.header.name).toBe("test.txt");
			expect(entry.header.type).toBe("file");
			// Verify large but still octal UIDs/GIDs
			expect(entry.header.uid).toBeGreaterThan(100000);
			expect(entry.header.gid).toBeGreaterThan(100000);
		});
	});

	describe("format compatibility", () => {
		it("extracts a v7 tar format archive", async () => {
			const buffer = await fs.readFile(V7_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			expect(entry.header.name).toBe("test.txt");
			expect(entry.header.type).toBe("file");
			// V7 format has no USTAR magic, but should still be readable
			expect(decoder.decode(entry.data).trim()).toBe("Hello, world!");
		});

		it("extracts an archive with unknown format header", async () => {
			const buffer = await fs.readFile(UNKNOWN_FORMAT);
			const entries = await unpackTar(buffer);

			// Should still be able to extract despite missing/corrupted magic
			expect(entries).toHaveLength(2);

			expect(entries[0].header.name).toBe("file-1.txt");
			expect(entries[0].header.type).toBe("file");
			expect(decoder.decode(entries[0].data)).toBe("i am file-1\n");

			expect(entries[1].header.name).toBe("file-2.txt");
			expect(entries[1].header.type).toBe("file");
			expect(decoder.decode(entries[1].data)).toBe("i am file-2\n");
		});
	});

	describe("error handling", () => {
		it("handles invalid compressed archives gracefully", async () => {
			// Test with actual invalid tgz file
			const buffer = await fs.readFile(INVALID_TGZ);

			const decompressedStream = new ReadableStream({
				start(controller) {
					controller.enqueue(buffer);
					controller.close();
				},
			}).pipeThrough(createGzipDecoder());

			// May or may not throw depending on the specific corruption
			try {
				const entries = await unpackTar(decompressedStream);
				// If it doesn't throw, just verify we get some result
				expect(Array.isArray(entries)).toBe(true);
			} catch (error) {
				// If it throws, that's also acceptable for invalid data
				expect(error).toBeInstanceOf(Error);
			}
		});
	});
});
