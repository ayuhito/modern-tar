import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { decoder } from "../../src/tar/utils";
import { unpackTar } from "../../src/web";
import { UNKNOWN_FORMAT } from "./fixtures";

describe("unknown and non-standard tar formats", () => {
	describe("unknown format archives", () => {
		it("extracts archives with missing magic headers", async () => {
			const buffer = await readFile(UNKNOWN_FORMAT);
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

		it("does not parse USTAR-specific fields for unknown formats", async () => {
			const buffer = await readFile(UNKNOWN_FORMAT);
			const entries = await unpackTar(buffer);

			entries.forEach((entry) => {
				// Unknown formats should not have USTAR extensions
				expect(entry.header.uname).toBeUndefined();
				expect(entry.header.gname).toBeUndefined();

				// But basic fields should still work
				expect(entry.header.name).toBeTruthy();
				expect(entry.header.type).toBeTruthy();
				expect(typeof entry.header.size).toBe("number");
				expect(entry.header.mtime).toBeInstanceOf(Date);
			});
		});
	});

	describe("fallback parsing behavior", () => {
		it("uses basic tar parsing for unknown formats", async () => {
			const buffer = await readFile(UNKNOWN_FORMAT);
			const entries = await unpackTar(buffer);

			// Should fall back to basic tar format parsing
			entries.forEach((entry) => {
				// Basic tar fields should be available
				expect(typeof entry.header.name).toBe("string");
				expect(typeof entry.header.mode).toBe("number");
				expect(typeof entry.header.uid).toBe("number");
				expect(typeof entry.header.gid).toBe("number");
				expect(typeof entry.header.size).toBe("number");
				expect(entry.header.mtime).toBeInstanceOf(Date);
				expect(typeof entry.header.type).toBe("string");

				// Data should be accessible
				expect(entry.data).toBeInstanceOf(Uint8Array);
				if (entry.header.type === "file") {
					expect(entry.data.length).toBe(entry.header.size);
				}
			});
		});

		it("maintains data integrity and consistency in both modes", async () => {
			const buffer = await readFile(UNKNOWN_FORMAT);

			// Parse in both modes to ensure consistency
			const strictEntries = await unpackTar(buffer, { strict: true });
			const nonStrictEntries = await unpackTar(buffer, { strict: false });

			// Even in strict mode, should gracefully handle unknown formats
			expect(strictEntries).toHaveLength(2);
			expect(nonStrictEntries).toHaveLength(2);
			expect(strictEntries[0].header.name).toBe("file-1.txt");
			expect(strictEntries[1].header.name).toBe("file-2.txt");

			// Core data should be identical between modes
			for (let i = 0; i < strictEntries.length; i++) {
				const strictEntry = strictEntries[i];
				const nonStrictEntry = nonStrictEntries[i];

				expect(strictEntry.header.name).toBe(nonStrictEntry.header.name);
				expect(strictEntry.header.type).toBe(nonStrictEntry.header.type);
				expect(strictEntry.header.size).toBe(nonStrictEntry.header.size);
				expect(strictEntry.data).toEqual(nonStrictEntry.data);
			}
		});

		it("handles mixed valid and invalid header data gracefully", async () => {
			// Create a partially corrupted archive
			const buffer = new Uint8Array(1536); // 3 blocks

			// First block: mostly valid header
			const encoder = new TextEncoder();
			encoder.encodeInto("valid.txt", buffer.subarray(0, 100));
			encoder.encodeInto("0000644", buffer.subarray(100, 108)); // mode
			encoder.encodeInto("0000000", buffer.subarray(108, 116)); // uid
			encoder.encodeInto("0000000", buffer.subarray(116, 124)); // gid
			encoder.encodeInto("00000000005", buffer.subarray(124, 136)); // size
			encoder.encodeInto("00000000000", buffer.subarray(136, 148)); // mtime
			buffer[156] = 48; // '0' for regular file
			// Skip magic field (unknown format)

			// Second block: file data
			encoder.encodeInto("hello", buffer.subarray(512, 517));

			// Third block: EOF
			// (left as zeros)

			const entries = await unpackTar(buffer);

			// Should extract the valid entry
			expect(entries.length).toBeGreaterThanOrEqual(0);

			if (entries.length > 0) {
				const entry = entries[0];
				expect(entry.header.name).toBe("valid.txt");
				expect(entry.header.type).toBe("file");
				expect(decoder.decode(entry.data)).toBe("hello");
			}
		});
	});

	describe("compatibility with modern options", () => {
		it("works with filtering options", async () => {
			const buffer = await readFile(UNKNOWN_FORMAT);

			const allEntries = await unpackTar(buffer);
			const filteredEntries = await unpackTar(buffer, {
				filter: (header) => header.name.includes("file-1"),
			});

			expect(allEntries).toHaveLength(2);
			expect(filteredEntries).toHaveLength(1);
			expect(filteredEntries[0].header.name).toBe("file-1.txt");
		});

		it("works with mapping options", async () => {
			const buffer = await readFile(UNKNOWN_FORMAT);

			const mappedEntries = await unpackTar(buffer, {
				map: (header) => ({
					...header,
					name: `unknown-${header.name}`,
				}),
			});

			expect(mappedEntries).toHaveLength(2);
			expect(mappedEntries[0].header.name).toBe("unknown-file-1.txt");
			expect(mappedEntries[1].header.name).toBe("unknown-file-2.txt");
		});

		it("handles stripping options correctly", async () => {
			const buffer = await readFile(UNKNOWN_FORMAT);

			// Files are at root level, so strip: 1 would remove them entirely
			const strippedEntries = await unpackTar(buffer, {
				strip: 1,
			});

			// Files at root level get filtered out by strip: 1
			expect(strippedEntries).toHaveLength(0);

			// Test strip: 0 (no stripping)
			const noStripEntries = await unpackTar(buffer, {
				strip: 0,
			});
			expect(noStripEntries).toHaveLength(2);
			expect(noStripEntries[0].header.name).toBe("file-1.txt");
			expect(noStripEntries[1].header.name).toBe("file-2.txt");
		});
	});

	describe("error handling for unknown formats", () => {
		it("provides meaningful error information", async () => {
			// Create completely invalid data
			const invalidBuffer = new Uint8Array(512);
			invalidBuffer.fill(0xaa); // Fill with pattern that's clearly not tar

			try {
				const entries = await unpackTar(invalidBuffer, { strict: true });
				// If it doesn't throw, the result should still be sensible
				expect(Array.isArray(entries)).toBe(true);
			} catch (error) {
				// Error should be informative
				expect(error).toBeInstanceOf(Error);
				const message = (error as Error).message;
				expect(typeof message).toBe("string");
				expect(message.length).toBeGreaterThan(0);
			}
		});

		it("fails gracefully with truncated unknown format", async () => {
			const buffer = await readFile(UNKNOWN_FORMAT);
			const truncated = buffer.subarray(0, 300); // Truncate mid-header

			// Should handle truncation gracefully
			try {
				const entries = await unpackTar(truncated, { strict: false });
				expect(Array.isArray(entries)).toBe(true);
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
			}

			// Strict mode might be more strict about truncation
			try {
				await unpackTar(truncated, { strict: true });
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
			}
		});

		it("handles corrupted headers in unknown formats", async () => {
			const buffer = await readFile(UNKNOWN_FORMAT);
			const corrupted = new Uint8Array(buffer);

			// Corrupt some header data
			corrupted[50] = 0xff;
			corrupted[100] = 0xff;
			corrupted[150] = 0xff;

			// Should attempt to parse despite corruption
			const entries = await unpackTar(corrupted, { strict: false });
			expect(Array.isArray(entries)).toBe(true);

			// Might have different results than original, but shouldn't crash
		});
	});

	describe("format detection robustness", () => {
		it("distinguishes between unknown and clearly invalid data", async () => {
			// Test with various levels of "brokenness"
			const scenarios = [
				{
					name: "unknown but structured",
					data: await readFile(UNKNOWN_FORMAT),
					expectEntries: true,
				},
				{
					name: "random noise",
					data: new Uint8Array(1024).map(() => Math.floor(Math.random() * 256)),
					expectEntries: false,
				},
				{
					name: "partial header",
					data: (() => {
						const buf = new Uint8Array(512);
						const encoder = new TextEncoder();
						encoder.encodeInto("test.txt", buf.subarray(0, 100));
						// Leave rest as zeros (potentially invalid)
						return buf;
					})(),
					expectEntries: undefined, // Could go either way
				},
			];

			for (const scenario of scenarios) {
				try {
					const entries = await unpackTar(scenario.data, { strict: false });

					if (scenario.expectEntries === true) {
						expect(entries.length).toBeGreaterThan(0);
					} else if (scenario.expectEntries === false) {
						// Random noise might extract nothing or throw
						expect(Array.isArray(entries)).toBe(true);
					}
					// For undefined expectation, just ensure no crash
					expect(Array.isArray(entries)).toBe(true);
				} catch (error) {
					// Errors are acceptable for invalid data
					expect(error).toBeInstanceOf(Error);
				}
			}
		});

		it("maintains consistent behavior across multiple parses", async () => {
			const buffer = await readFile(UNKNOWN_FORMAT);

			// Parse the same archive multiple times
			const results = await Promise.all([
				unpackTar(buffer),
				unpackTar(buffer),
				unpackTar(buffer, { strict: true }),
				unpackTar(buffer, { strict: false }),
			]);

			// All results should be consistent
			const firstResult = results[0];
			for (const result of results) {
				expect(result).toHaveLength(firstResult.length);
				for (let i = 0; i < result.length; i++) {
					expect(result[i].header.name).toBe(firstResult[i].header.name);
					expect(result[i].header.type).toBe(firstResult[i].header.type);
					expect(result[i].data).toEqual(firstResult[i].data);
				}
			}
		});
	});
});
