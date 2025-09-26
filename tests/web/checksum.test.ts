import { describe, expect, it } from "vitest";
import { createTarPacker, packTar, unpackTar } from "../../src/web";
import { USTAR } from "../../src/web/constants";

describe("checksum validation", () => {
	it("should reject tar entries with corrupted checksums", async () => {
		const buffer = await packTar([
			{
				header: { name: "corrupt.txt", size: 4, type: "file" },
				body: "test",
			},
		]);

		// Corrupt the checksum by changing the first byte
		buffer[USTAR.checksum.offset] = buffer[USTAR.checksum.offset] + 1;

		await expect(unpackTar(buffer)).rejects.toThrow(
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
		for (let i = 0; i < USTAR.checksum.size; i++) {
			buffer[USTAR.checksum.offset + i] = 0;
		}

		await expect(unpackTar(buffer)).rejects.toThrow(
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
		buffer[USTAR.name.offset] = buffer[USTAR.name.offset] + 1;

		await expect(unpackTar(buffer)).rejects.toThrow(
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
		buffer[USTAR.size.offset] = buffer[USTAR.size.offset] + 1;

		await expect(unpackTar(buffer)).rejects.toThrow(
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
		await writer.write(new TextEncoder().encode("valid"));
		await writer.close();

		// Second entry (will be corrupted)
		const file2Stream = controller.add({
			name: "corrupt.txt",
			size: 7,
			type: "file",
		});

		writer = file2Stream.getWriter();
		await writer.write(new TextEncoder().encode("corrupt"));
		await writer.close();

		controller.finalize();

		// Read the archive and corrupt the second entry
		const buffer = await new Response(readable).arrayBuffer();
		const corruptedBuffer = new Uint8Array(buffer);

		// Find the second header (skip first header + content + padding)
		const firstEntrySize = 5;
		const firstEntryPadding = (512 - (firstEntrySize % 512)) % 512;
		const secondHeaderOffset = 512 + firstEntrySize + firstEntryPadding;

		// Corrupt the checksum of the second entry
		const secondChecksumOffset = secondHeaderOffset + USTAR.checksum.offset;
		corruptedBuffer[secondChecksumOffset] =
			corruptedBuffer[secondChecksumOffset] + 1;

		// The entire extraction should fail when encountering the corrupted second entry
		await expect(unpackTar(corruptedBuffer)).rejects.toThrow(
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
		buffer[USTAR.checksum.offset] = buffer[USTAR.checksum.offset] + 1;

		await expect(unpackTar(buffer)).rejects.toThrow(
			"Invalid tar header checksum",
		);
	});
});
