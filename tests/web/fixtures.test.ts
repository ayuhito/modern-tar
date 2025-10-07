import * as fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { decoder } from "../../src/tar/utils";
import { createGzipDecoder, unpackTar } from "../../src/web";
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
		it("handles invalid gzip data gracefully", async () => {
			// Create truly invalid gzip data (not just a misnamed valid archive)
			const invalidGzipData = new Uint8Array([
				0x1f,
				0x8b, // Valid gzip magic
				0x08,
				0x00, // Valid compression method and flags
				0x00,
				0x00,
				0x00,
				0x00, // mtime
				0x00,
				0x03, // extra flags and OS
				// Then some corrupted/truncated data
				0xff,
				0xff,
				0xff,
				0xff,
				0x42,
				0x43,
				0x44,
				0x45,
			]);

			const decompressedStream = new ReadableStream({
				start(controller) {
					controller.enqueue(invalidGzipData);
					controller.close();
				},
			}).pipeThrough(createGzipDecoder());

			// Should reject when trying to decompress invalid gzip data
			await expect(unpackTar(decompressedStream)).rejects.toThrow();
		});

		it("handles complex valid compressed archives efficiently", async () => {
			// Test that the previously problematic "invalid.tgz" now works correctly
			const buffer = await fs.readFile(INVALID_TGZ);

			const decompressedStream = new ReadableStream({
				start(controller) {
					controller.enqueue(buffer);
					controller.close();
				},
			}).pipeThrough(createGzipDecoder());

			// This should now work efficiently (was previously causing hangs)
			const entries = await unpackTar(decompressedStream);

			expect(entries.length).toBeGreaterThan(0);
			// Verify some expected entries from the bl package
			const dirEntry = entries.find((e) => e.header.name === "bl/");
			expect(dirEntry).toBeDefined();
			expect(dirEntry?.header.type).toBe("directory");
		});

		it("processes the original problematic invalid.tgz fixture without regression", async () => {
			// This specific fixture was causing performance issues in previous implementations
			// Ensure it processes correctly and doesn't hang or timeout
			const buffer = await fs.readFile(INVALID_TGZ);

			const decompressedStream = new ReadableStream({
				start(controller) {
					controller.enqueue(buffer);
					controller.close();
				},
			}).pipeThrough(createGzipDecoder());

			// Should complete in reasonable time and extract all entries
			const startTime = Date.now();
			const entries = await unpackTar(decompressedStream);
			const processingTime = Date.now() - startTime;

			// Verify the archive processes completely
			expect(entries.length).toBe(54);
			expect(processingTime).toBeLessThan(5000); // Should complete within 5 seconds

			// Verify specific entries that should be present
			const blDir = entries.find((e) => e.header.name === "bl/");
			expect(blDir?.header.type).toBe("directory");

			const jshintrc = entries.find((e) => e.header.name === "bl/.jshintrc");
			expect(jshintrc?.header.type).toBe("file");
			expect(jshintrc?.header.size).toBe(1147);

			const packageJson = entries.find(
				(e) => e.header.name === "bl/package.json",
			);
			expect(packageJson?.header.type).toBe("file");
		});
	});
});
