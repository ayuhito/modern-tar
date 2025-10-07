import * as fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { writeChecksum } from "../../src/tar/checksum";
import {
	BLOCK_SIZE,
	TYPEFLAG,
	USTAR_CHECKSUM_OFFSET,
	USTAR_MODE_OFFSET,
	USTAR_NAME_OFFSET,
	USTAR_SIZE_OFFSET,
	USTAR_TYPEFLAG_OFFSET,
} from "../../src/tar/constants";
import type { ParsedTarEntry } from "../../src/tar/types";
import { decoder, encoder } from "../../src/tar/utils";

import { createTarDecoder, packTar, unpackTar } from "../../src/web";
import {
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

	it("throws an error for an incomplete archive in strict mode", async () => {
		const buffer = await fs.readFile(INCOMPLETE_TAR);

		// We expect unpackTar to reject because the archive is truncated in strict mode
		await expect(unpackTar(buffer, { strict: true })).rejects.toThrow(
			"Tar archive is truncated.",
		);
	});

	it("handles incomplete archive gracefully in non-strict mode", async () => {
		const buffer = await fs.readFile(INCOMPLETE_TAR);

		// In non-strict mode, it should extract what it can and warn about truncation
		const entries = await unpackTar(buffer, { strict: false });

		// Should extract the complete entry successfully
		expect(entries).toHaveLength(1);
		expect(entries[0].header.name).toBe("file-1.txt");
		expect(decoder.decode(entries[0].data)).toBe("i am file-1\n");
	});

	it("extracts a tar with a huge file using PAX headers for size", async () => {
		const hugeFileSize = "8804630528"; // ~8.2 GB, as a string
		const smallBody = "this is a placeholder body";
		const bodyBuffer = encoder.encode(smallBody);

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
			expect(entry.header.size).toBe(parseInt(hugeFileSize, 10));

			// Read just a small portion of the body to verify it starts correctly
			const bodyReader = entry.body.getReader();
			const chunk = await bodyReader.read();
			const partialContent = decoder.decode(chunk.value);
			// Trim null bytes that are part of TAR padding
			expect(partialContent.replace(/\0+$/, "")).toBe(smallBody);
			bodyReader.releaseLock();
		}
	});

	it("handles malformed tar archive with invalid checksum", async () => {
		// Create a buffer that looks like a tar header but has invalid checksum
		const invalidHeader = new Uint8Array(BLOCK_SIZE);

		// Fill in some basic header fields but leave checksum invalid
		const nameBytes = encoder.encode("test.txt");
		invalidHeader.set(nameBytes, USTAR_NAME_OFFSET);

		// Set some other fields to make it look like a valid header
		const modeBytes = encoder.encode("0000644 ");
		invalidHeader.set(modeBytes, USTAR_MODE_OFFSET);

		// Invalid checksum
		const checksumBytes = encoder.encode("000000 ");
		invalidHeader.set(checksumBytes, USTAR_CHECKSUM_OFFSET);

		// @ts-expect-error ReadableStream.from is supported in tests.
		const sourceStream = ReadableStream.from([invalidHeader]);
		const entryStream = sourceStream.pipeThrough(
			createTarDecoder({ strict: true }),
		);
		const reader = entryStream.getReader();

		await expect(reader.read()).rejects.toThrow("Invalid tar header checksum");
	});

	it("handles malformed PAX records with invalid length", async () => {
		// Create a PAX header with malformed length record
		const paxData = encoder.encode("abc path=test.txt\n"); // Invalid length format

		// Pad to block size
		const paxDataPadded = new Uint8Array(BLOCK_SIZE);
		paxDataPadded.set(paxData);

		// Create PAX header
		const paxHeader = new Uint8Array(BLOCK_SIZE);
		const nameBytes = encoder.encode("PaxHeaders.0/test.txt");
		paxHeader.set(nameBytes, USTAR_NAME_OFFSET);

		const modeBytes = encoder.encode("0000644 ");
		paxHeader.set(modeBytes, USTAR_MODE_OFFSET);

		const sizeBytes = encoder.encode(
			`${paxData.length.toString(8).padStart(11, "0")} `,
		);
		paxHeader.set(sizeBytes, USTAR_SIZE_OFFSET);

		// Set type flag for PAX header
		paxHeader[USTAR_TYPEFLAG_OFFSET] = encoder.encode(
			TYPEFLAG["pax-header"],
		)[0];

		writeChecksum(paxHeader);

		const combined = new Uint8Array(BLOCK_SIZE * 2);
		combined.set(paxHeader, 0);
		combined.set(paxDataPadded, BLOCK_SIZE);

		// @ts-expect-error ReadableStream.from is supported.
		const sourceStream = ReadableStream.from([combined]);
		const entryStream = sourceStream.pipeThrough(createTarDecoder());
		const reader = entryStream.getReader();

		// Should handle malformed PAX records gracefully
		const result = await reader.read();

		expect(result.done).toBe(true);
	});

	it("handles single zero block without second zero block", async () => {
		// Create a tar with one entry followed by only one zero block
		const entry = {
			header: {
				name: "test.txt",
				size: 5,
				type: "file" as const,
			},
			body: "hello",
		};

		const tarBuffer = await packTar([entry]);

		// Truncate to remove the second zero block
		const truncated = tarBuffer.slice(0, tarBuffer.length - BLOCK_SIZE);

		// @ts-expect-error ReadableStream.from is supported.
		const sourceStream = ReadableStream.from([truncated]);
		const entryStream = sourceStream.pipeThrough(createTarDecoder());
		const reader = entryStream.getReader();

		// Should read the entry successfully
		const result = await reader.read();
		expect(result.done).toBe(false);
		expect(result.value?.header.name).toBe("test.txt");

		// Next read should not terminate immediately due to single zero block
		const nextResult = await reader.read();
		expect(nextResult.done).toBe(true);
	});

	it("handles stream body controller close errors", async () => {
		// Create a tar entry with empty body to trigger controller.close()
		const entry = {
			header: {
				name: "empty.txt",
				size: 0,
				type: "file" as const,
			},
			body: "",
		};

		const tarBuffer = await packTar([entry]);

		// @ts-expect-error ReadableStream.from is supported.
		const sourceStream = ReadableStream.from([tarBuffer]);
		const entryStream = sourceStream.pipeThrough(createTarDecoder());
		const reader = entryStream.getReader();

		const result = await reader.read();
		expect(result.done).toBe(false);

		if (!result.done) {
			// The body should be empty and controller should be closed
			const bodyReader = result.value.body.getReader();
			const bodyResult = await bodyReader.read();
			expect(bodyResult.done).toBe(true);
		}
	});

	it("handles truncated archive in middle of entry in strict mode", async () => {
		const validEntry = {
			header: {
				name: "test.txt",
				size: 10,
				type: "file" as const,
			},
			body: "hello test",
		};

		const validTarBuffer = await packTar([validEntry]);

		// Truncate the archive in the middle of the entry data
		const truncated = validTarBuffer.slice(0, BLOCK_SIZE + 5); // Header + 5 bytes of 10-byte data

		// @ts-expect-error ReadableStream.from is supported in tests.
		const sourceStream = ReadableStream.from([truncated]);
		const decoder = createTarDecoder({ strict: true });

		const writable = new WritableStream({
			write() {
				// Do nothing
			},
		});

		// Should handle truncation in flush method
		await expect(
			sourceStream.pipeThrough(decoder).pipeTo(writable),
		).rejects.toThrow("Tar archive is truncated");
	});

	it("handles truncated archive in middle of entry gracefully in non-strict mode", async () => {
		// Create a valid entry
		const validEntry = {
			header: {
				name: "test.txt",
				size: 10,
				type: "file" as const,
			},
			body: "hello test",
		};

		const validTarBuffer = await packTar([validEntry]);

		// Truncate the archive in the middle of the entry data
		const truncated = validTarBuffer.slice(0, BLOCK_SIZE + 5); // Header + 5 bytes of 10-byte data

		// @ts-expect-error ReadableStream.from is supported in tests.
		const sourceStream = ReadableStream.from([truncated]);
		const decoder = createTarDecoder({ strict: false });

		const entries: ParsedTarEntry[] = [];
		const writable = new WritableStream({
			write(entry: ParsedTarEntry) {
				entries.push(entry);
			},
		});

		// Should handle truncation gracefully in non-strict mode
		await sourceStream.pipeThrough(decoder).pipeTo(writable);

		expect(entries).toHaveLength(1);
		expect(entries[0].header.name).toBe("test.txt");
		// The body stream should be closed gracefully even though truncated
	});

	it("handles unexpected data at end of archive in strict mode", async () => {
		let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

		const sourceStream = new ReadableStream<Uint8Array>({
			start(c) {
				controller = c;
			},
		});

		const decoder = createTarDecoder({ strict: true });
		const entriesStream = sourceStream.pipeThrough(decoder);
		const reader = entriesStream.getReader();
		const readPromise = reader.read();

		// Leftover data
		// biome-ignore lint/style/noNonNullAssertion: Already setup.
		controller!.enqueue(new Uint8Array([0x42, 0x43, 0x44]));

		// Should trigger flush with non-zero buffer
		// biome-ignore lint/style/noNonNullAssertion: Already setup.
		controller!.close();

		// The flush method should detect non-zero buffer and error in strict mode
		await expect(readPromise).rejects.toThrow("Invalid EOF.");
	});

	it("handles unexpected data at end of archive gracefully in non-strict mode", async () => {
		let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

		const sourceStream = new ReadableStream<Uint8Array>({
			start(c) {
				controller = c;
			},
		});

		const decoder = createTarDecoder({ strict: false });
		const entriesStream = sourceStream.pipeThrough(decoder);
		const reader = entriesStream.getReader();
		const readPromise = reader.read();

		// Leftover data
		// biome-ignore lint/style/noNonNullAssertion: Already setup.
		controller!.enqueue(new Uint8Array([0x42, 0x43, 0x44]));

		// Should trigger flush with non-zero buffer
		// biome-ignore lint/style/noNonNullAssertion: Already setup.
		controller!.close();

		// The flush method should warn but not error in non-strict mode
		const result = await readPromise;
		expect(result.done).toBe(true);
	});

	it("handles PAX record with zero length", async () => {
		// Create malformed PAX data with zero-length record
		const paxData = encoder.encode("0 \n"); // Zero length record

		// Pad to block size
		const paxDataPadded = new Uint8Array(BLOCK_SIZE);
		paxDataPadded.set(paxData);

		// Create PAX header similar to previous test
		const paxHeader = new Uint8Array(BLOCK_SIZE);
		const nameBytes = encoder.encode("PaxHeaders.0/test.txt");
		paxHeader.set(nameBytes, USTAR_NAME_OFFSET);

		const modeBytes = encoder.encode("0000644 ");
		paxHeader.set(modeBytes, USTAR_MODE_OFFSET);

		const sizeBytes = encoder.encode(
			`${paxData.length.toString(8).padStart(11, "0")} `,
		);
		paxHeader.set(sizeBytes, USTAR_SIZE_OFFSET);

		paxHeader[USTAR_TYPEFLAG_OFFSET] = encoder.encode(
			TYPEFLAG["pax-header"],
		)[0];

		// Calculate and set checksum
		writeChecksum(paxHeader);

		const combined = new Uint8Array(BLOCK_SIZE * 2);
		combined.set(paxHeader, 0);
		combined.set(paxDataPadded, BLOCK_SIZE);

		// @ts-expect-error ReadableStream.from is supported.
		const sourceStream = ReadableStream.from([combined]);
		const entryStream = sourceStream.pipeThrough(createTarDecoder());
		const reader = entryStream.getReader();

		// Should handle zero-length PAX records gracefully
		const result = await reader.read();
		expect(result.done).toBe(true);
	});

	it("handles PAX record with missing equals sign", async () => {
		// Create PAX data without proper key=value format
		const paxData = encoder.encode("20 pathwithoutequals\n");

		// Pad to block size
		const paxDataPadded = new Uint8Array(BLOCK_SIZE);
		paxDataPadded.set(paxData);

		// Create PAX header
		const paxHeader = new Uint8Array(BLOCK_SIZE);
		const nameBytes = encoder.encode("PaxHeaders.0/test.txt");
		paxHeader.set(nameBytes, USTAR_NAME_OFFSET);

		const modeBytes = encoder.encode("0000644 ");
		paxHeader.set(modeBytes, USTAR_MODE_OFFSET);

		const sizeBytes = encoder.encode(
			`${paxData.length.toString(8).padStart(11, "0")} `,
		);
		paxHeader.set(sizeBytes, USTAR_SIZE_OFFSET);

		paxHeader[USTAR_TYPEFLAG_OFFSET] = encoder.encode(
			TYPEFLAG["pax-header"],
		)[0];

		// Calculate and set checksum
		writeChecksum(paxHeader);

		const combined = new Uint8Array(BLOCK_SIZE * 2);
		combined.set(paxHeader, 0);
		combined.set(paxDataPadded, BLOCK_SIZE);

		// @ts-expect-error ReadableStream.from is supported.
		const sourceStream = ReadableStream.from([combined]);
		const entryStream = sourceStream.pipeThrough(createTarDecoder());
		const reader = entryStream.getReader();

		// Should handle malformed PAX records gracefully
		const result = await reader.read();
		expect(result.done).toBe(true);
	});
});
