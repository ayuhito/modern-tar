import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { writeChecksum } from "../../src/tar/checksum";
import { decoder, encoder } from "../../src/tar/utils";
import { unpackTar } from "../../src/web";
import { GNU_INCREMENTAL_TAR, GNU_LONG_PATH, GNU_TAR } from "./fixtures";

describe("GNU format support", () => {
	describe("basic GNU format", () => {
		it("extracts a gnu format tar", async () => {
			const buffer = await readFile(GNU_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			expect(entry.header.name).toBe("test.txt");
			expect(entry.header.size).toBe(14);
			expect(entry.header.uid).toBe(12345);
			expect(entry.header.gid).toBe(67890);
			expect(entry.header.uname).toBe("myuser");
			expect(entry.header.gname).toBe("mygroup");

			const content = decoder.decode(entry.data).trim();
			expect(content).toBe("Hello, world!");
		});

		it("extracts a gnu format tar in strict mode", async () => {
			const buffer = await readFile(GNU_TAR);
			const entries = await unpackTar(buffer, { strict: true });

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			expect(entry.header.name).toBe("test.txt");
			expect(entry.header.size).toBe(14);
			expect(entry.header.uid).toBe(12345);
			expect(entry.header.gid).toBe(67890);
			expect(entry.header.uname).toBe("myuser");
			expect(entry.header.gname).toBe("mygroup");

			const content = decoder.decode(entry.data).trim();
			expect(content).toBe("Hello, world!");
		});

		it("correctly parses GNU incremental format archives", async () => {
			const buffer = await readFile(GNU_INCREMENTAL_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const entry = entries[0];

			expect(entry.header.name).toBe("test.txt");
			expect(entry.header.type).toBe("file");
			expect(entry.header.uid).toBe(12345);
			expect(entry.header.gid).toBe(67890);
			expect(entry.header.uname).toBe("myuser");
			expect(entry.header.gname).toBe("mygroup");

			const content = decoder.decode(entry.data).trim();
			expect(content).toBe("Hello, world!");
		});

		it("does not apply prefix for GNU tar format", async () => {
			// GNU incremental tar has non-pathname data in prefix field
			const buffer = await readFile(GNU_INCREMENTAL_TAR);
			const entries = await unpackTar(buffer, { strict: true });

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			// Should NOT have prefix applied (would be corrupted filename if it did)
			expect(entry.header.name).toBe("test.txt");
			expect(entry.header.name).not.toContain("1347402"); // timestamp data
		});
	});

	describe("GNU long filename support", () => {
		it("correctly parses GNU long path archives", async () => {
			const buffer = await readFile(GNU_LONG_PATH);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);

			const entry = entries[0];
			const expectedLongName =
				"node-v0.11.14/deps/npm/node_modules/init-package-json/node_modules/promzard/example/npm-init/init-input.js";

			// Verify the long filename was correctly parsed (not truncated)
			expect(entry.header.name).toBe(expectedLongName);
			expect(entry.header.name.length).toBeGreaterThan(100); // Exceeds USTAR limit
			expect(entry.header.type).toBe("file");

			// Verify file content is accessible
			const content = decoder.decode(entry.data);
			expect(content).toContain("var fs = require('fs')");
			expect(content).toContain("module.exports");
			expect(content).toContain("prompt('name'");
		});

		describe("GNU long link support", () => {
			it("handles GNU long link names (gnu-long-link-name)", async () => {
				const longLinkName = "a".repeat(200); // Exceeds USTAR 100-char limit

				// Manually construct a tar with gnu-long-link-name entry type
				const linkNameHeader = new Uint8Array(512);
				encoder.encodeInto("././@LongLink", linkNameHeader.subarray(0, 100));
				encoder.encodeInto("0000000", linkNameHeader.subarray(100, 108)); // mode
				encoder.encodeInto("0000000", linkNameHeader.subarray(108, 116)); // uid
				encoder.encodeInto("0000000", linkNameHeader.subarray(116, 124)); // gid
				const linkNameSize = (longLinkName.length + 1)
					.toString(8)
					.padStart(11, "0");
				encoder.encodeInto(linkNameSize, linkNameHeader.subarray(124, 135));
				encoder.encodeInto("00000000000", linkNameHeader.subarray(136, 148)); // mtime
				linkNameHeader[156] = 75; // 'K' = gnu-long-link-name type
				encoder.encodeInto("ustar  ", linkNameHeader.subarray(257, 265));
				writeChecksum(linkNameHeader);

				// Link name data (padded to 512-byte boundary)
				const linkNameData = new Uint8Array(512);
				encoder.encodeInto(`${longLinkName}\0`, linkNameData);

				// Main symlink entry header
				const symlinkHeader = new Uint8Array(512);
				encoder.encodeInto("symlink-file", symlinkHeader.subarray(0, 100));
				encoder.encodeInto("0000644", symlinkHeader.subarray(100, 108));
				encoder.encodeInto("0001750", symlinkHeader.subarray(108, 116));
				encoder.encodeInto("0001750", symlinkHeader.subarray(116, 124));
				encoder.encodeInto("00000000000", symlinkHeader.subarray(124, 136));
				encoder.encodeInto("14157760701", symlinkHeader.subarray(136, 148));
				symlinkHeader[156] = 50; // '2' = symlink type
				encoder.encodeInto("truncated-name", symlinkHeader.subarray(157, 257)); // truncated linkname
				encoder.encodeInto("ustar", symlinkHeader.subarray(257, 262));
				encoder.encodeInto("00", symlinkHeader.subarray(263, 265));
				writeChecksum(symlinkHeader);

				// EOF blocks
				const eofBlock1 = new Uint8Array(512);
				const eofBlock2 = new Uint8Array(512);

				// Combine all parts
				const archive = new Uint8Array(
					linkNameHeader.length +
						linkNameData.length +
						symlinkHeader.length +
						eofBlock1.length +
						eofBlock2.length,
				);
				archive.set(linkNameHeader, 0);
				archive.set(linkNameData, 512);
				archive.set(symlinkHeader, 1024);
				archive.set(eofBlock1, 1536);
				archive.set(eofBlock2, 2048);

				const entries = await unpackTar(archive);
				expect(entries).toHaveLength(1);

				const entry = entries[0];
				expect(entry.header.name).toBe("symlink-file");
				expect(entry.header.type).toBe("symlink");
				expect(entry.header.linkname).toBe(longLinkName); // Should use the long link name
			});

			it("handles GNU long file names (gnu-long-name)", async () => {
				// Create a tar with a GNU long file name entry
				const longFileName = `very-long-directory-name/${"x".repeat(150)}.txt`;

				// Manually construct a tar with gnu-long-name entry type
				const fileNameHeader = new Uint8Array(512);
				encoder.encodeInto("././@LongLink", fileNameHeader.subarray(0, 100));
				encoder.encodeInto("0000000", fileNameHeader.subarray(100, 108)); // mode
				encoder.encodeInto("0000000", fileNameHeader.subarray(108, 116)); // uid
				encoder.encodeInto("0000000", fileNameHeader.subarray(116, 124)); // gid
				const fileNameSize = (longFileName.length + 1)
					.toString(8)
					.padStart(11, "0");
				encoder.encodeInto(fileNameSize, fileNameHeader.subarray(124, 135));
				encoder.encodeInto("00000000000", fileNameHeader.subarray(136, 148)); // mtime
				fileNameHeader[156] = 76; // 'L' = gnu-long-name type
				encoder.encodeInto("ustar  ", fileNameHeader.subarray(257, 265));
				writeChecksum(fileNameHeader);

				// File name data (padded to 512-byte boundary)
				const fileNameData = new Uint8Array(512);
				encoder.encodeInto(`${longFileName}\0`, fileNameData);

				// Main file entry header
				const fileHeader = new Uint8Array(512);
				encoder.encodeInto("truncated-name.txt", fileHeader.subarray(0, 100));
				encoder.encodeInto("0000644", fileHeader.subarray(100, 108));
				encoder.encodeInto("0001750", fileHeader.subarray(108, 116));
				encoder.encodeInto("0001750", fileHeader.subarray(116, 124));
				encoder.encodeInto("00000000005", fileHeader.subarray(124, 136)); // 5 bytes
				encoder.encodeInto("14157760701", fileHeader.subarray(136, 148));
				fileHeader[156] = 48; // '0' = regular file type
				encoder.encodeInto("ustar", fileHeader.subarray(257, 262));
				encoder.encodeInto("00", fileHeader.subarray(263, 265));
				writeChecksum(fileHeader);

				// File content
				const fileData = new Uint8Array(512);
				encoder.encodeInto("hello", fileData);

				// EOF blocks
				const eofBlock1 = new Uint8Array(512);
				const eofBlock2 = new Uint8Array(512);

				// Combine all parts
				const archive = new Uint8Array(
					fileNameHeader.length +
						fileNameData.length +
						fileHeader.length +
						fileData.length +
						eofBlock1.length +
						eofBlock2.length,
				);
				archive.set(fileNameHeader, 0);
				archive.set(fileNameData, 512);
				archive.set(fileHeader, 1024);
				archive.set(fileData, 1536);
				archive.set(eofBlock1, 2048);
				archive.set(eofBlock2, 2560);

				const entries = await unpackTar(archive);
				expect(entries).toHaveLength(1);

				const entry = entries[0];
				expect(entry.header.name).toBe(longFileName); // Should use the long file name
				expect(entry.header.type).toBe("file");
				expect(entry.header.size).toBe(5);
				expect(decoder.decode(entry.data)).toBe("hello");
			});

			it("ignores unknown GNU entry types gracefully", async () => {
				// Create a tar with an unknown GNU entry type that should be skipped
				const unknownHeader = new Uint8Array(512);
				encoder.encodeInto("././@Unknown", unknownHeader.subarray(0, 100));
				encoder.encodeInto("0000000", unknownHeader.subarray(100, 108)); // mode
				encoder.encodeInto("0000000", unknownHeader.subarray(108, 116)); // uid
				encoder.encodeInto("0000000", unknownHeader.subarray(116, 124)); // gid
				encoder.encodeInto("00000000005", unknownHeader.subarray(124, 136)); // size
				encoder.encodeInto("00000000000", unknownHeader.subarray(136, 148)); // mtime
				unknownHeader[156] = 88; // 'X' = unknown GNU type
				encoder.encodeInto("ustar  ", unknownHeader.subarray(257, 265));
				writeChecksum(unknownHeader);

				// Unknown data
				const unknownData = new Uint8Array(512);
				encoder.encodeInto("data", unknownData);

				// Regular file entry
				const fileHeader = new Uint8Array(512);
				encoder.encodeInto("normal.txt", fileHeader.subarray(0, 100));
				encoder.encodeInto("0000644", fileHeader.subarray(100, 108));
				encoder.encodeInto("0001750", fileHeader.subarray(108, 116));
				encoder.encodeInto("0001750", fileHeader.subarray(116, 124));
				encoder.encodeInto("00000000005", fileHeader.subarray(124, 136));
				encoder.encodeInto("14157760701", fileHeader.subarray(136, 148));
				fileHeader[156] = 48; // '0' = regular file
				encoder.encodeInto("ustar", fileHeader.subarray(257, 262));
				encoder.encodeInto("00", fileHeader.subarray(263, 265));
				writeChecksum(fileHeader);

				const fileData = new Uint8Array(512);
				encoder.encodeInto("hello", fileData);

				// EOF blocks
				const eofBlock1 = new Uint8Array(512);
				const eofBlock2 = new Uint8Array(512);

				const archive = new Uint8Array(
					unknownHeader.length +
						unknownData.length +
						fileHeader.length +
						fileData.length +
						eofBlock1.length +
						eofBlock2.length,
				);
				archive.set(unknownHeader, 0);
				archive.set(unknownData, 512);
				archive.set(fileHeader, 1024);
				archive.set(fileData, 1536);
				archive.set(eofBlock1, 2048);
				archive.set(eofBlock2, 2560);

				const entries = await unpackTar(archive);
				// Should contain both the unknown entry and the regular file
				// The unknown entry is parsed as a regular entry since it has valid header structure
				expect(entries).toHaveLength(2);
				expect(entries[0].header.name).toBe("././@Unknown");
				expect(entries[1].header.name).toBe("normal.txt");
				expect(decoder.decode(entries[1].data)).toBe("hello");
			});
		});
	});
});
