import { describe, expect, it } from "vitest";
import {
	USTAR_CHECKSUM_OFFSET,
	USTAR_CHECKSUM_SIZE,
	USTAR_NAME_OFFSET,
	USTAR_SIZE_OFFSET,
} from "../../src/tar/constants";
import { decoder, encoder, streamToBuffer } from "../../src/tar/utils";
import { createTarPacker, packTar, unpackTar } from "../../src/web";

describe("checksum validation", () => {
	it("should reject tar entries with corrupted checksums", async () => {
		const buffer = await packTar([
			{
				header: { name: "corrupt.txt", size: 4, type: "file" },
				body: "test",
			},
		]);

		// Corrupt the checksum by changing the first byte
		buffer[USTAR_CHECKSUM_OFFSET] = buffer[USTAR_CHECKSUM_OFFSET] + 1;

		await expect(unpackTar(buffer, { strict: true })).rejects.toThrow(
			"Invalid tar header checksum",
		);
	});

	it("should reject tar entries with zero checksum when header has content", async () => {
		const buffer = await packTar([
			{
				header: { name: "zero-checksum.txt", size: 6, type: "file" },
				body: "foobar",
			},
		]);

		// Zero out the checksum field
		for (let i = 0; i < USTAR_CHECKSUM_SIZE; i++) {
			buffer[USTAR_CHECKSUM_OFFSET + i] = 0;
		}

		await expect(unpackTar(buffer, { strict: true })).rejects.toThrow(
			"Invalid tar header checksum",
		);
	});

	it("should reject tar entries with corrupted filename affecting checksum", async () => {
		const buffer = await packTar([
			{
				header: { name: "filename.txt", size: 7, type: "file" },
				body: "content",
			},
		]);

		// Change the first character of the filename
		buffer[USTAR_NAME_OFFSET] = buffer[USTAR_NAME_OFFSET] + 1;

		await expect(unpackTar(buffer, { strict: true })).rejects.toThrow(
			"Invalid tar header checksum",
		);
	});

	it("should reject tar entries with corrupted file size affecting checksum", async () => {
		const buffer = await packTar([
			{
				header: { name: "sizetest.txt", size: 8, type: "file" },
				body: "sizebyte",
			},
		]);

		// Corrupt one byte in the size field
		buffer[USTAR_SIZE_OFFSET] = buffer[USTAR_SIZE_OFFSET] + 1;

		await expect(unpackTar(buffer, { strict: true })).rejects.toThrow(
			"Invalid tar header checksum",
		);
	});

	it("should handle multiple entries where only one has corrupted checksum", async () => {
		const { readable, controller } = createTarPacker();

		// First entry (will remain valid)
		const file1Stream = controller.add({
			name: "valid.txt",
			size: 5,
			type: "file",
		});
		let writer = file1Stream.getWriter();
		await writer.write(encoder.encode("valid"));
		await writer.close();

		// Second entry (will be corrupted)
		const file2Stream = controller.add({
			name: "corrupt.txt",
			size: 7,
			type: "file",
		});

		writer = file2Stream.getWriter();
		await writer.write(encoder.encode("corrupt"));
		await writer.close();

		controller.finalize();

		// Read the archive and corrupt the second entry
		const buffer = await streamToBuffer(readable);

		// Find the second header (skip first header + content + padding)
		const firstEntrySize = 5;
		const firstEntryPadding = (512 - (firstEntrySize % 512)) % 512;
		const secondHeaderOffset = 512 + firstEntrySize + firstEntryPadding;

		// Corrupt the checksum of the second entry
		const secondChecksumOffset = secondHeaderOffset + USTAR_CHECKSUM_OFFSET;
		buffer[secondChecksumOffset] = buffer[secondChecksumOffset] + 1;

		// The entire extraction should fail when encountering the corrupted second entry
		await expect(unpackTar(buffer, { strict: true })).rejects.toThrow(
			"Invalid tar header checksum",
		);
	});

	it("should reject directory entries with corrupted checksums", async () => {
		const buffer = await packTar([
			{
				header: { name: "corruptdir/", type: "directory", size: 0 },
			},
		]);

		// Corrupt the checksum
		buffer[USTAR_CHECKSUM_OFFSET] = buffer[USTAR_CHECKSUM_OFFSET] + 1;

		await expect(unpackTar(buffer, { strict: true })).rejects.toThrow(
			"Invalid tar header checksum",
		);
	});

	it("should create headers with correct checksums during packing", async () => {
		// Pack a simple archive
		const buffer = await packTar([
			{
				header: { name: "checksum-test.txt", size: 11, type: "file" },
				body: "hello world",
			},
		]);

		// If the checksum was calculated correctly during packing,
		// unpacking should succeed (since unpacker validates checksums)
		const entries = await unpackTar(buffer);
		expect(entries).toHaveLength(1);
		expect(entries[0].header.name).toBe("checksum-test.txt");
		expect(decoder.decode(entries[0].data)).toBe("hello world");
	});
});
