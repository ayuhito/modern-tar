import { describe, expect, it } from "vitest";
import { createTarPacker, unpackTar } from "../../src/web";
import { USTAR } from "../../src/web/constants";

describe("checksum validation", () => {
	it("should reject tar entries with corrupted checksums", async () => {
		// Create a valid tar archive first
		const { readable, controller } = createTarPacker();

		const fileStream = controller.add({
			name: "corrupt.txt",
			size: 4,
			type: "file"
		});

		const writer = fileStream.getWriter();
		await writer.write(new TextEncoder().encode("test"));
		await writer.close();

		controller.finalize();

		// Read the archive into a buffer so we can corrupt it
		const buffer = await new Response(readable).arrayBuffer();
		const corruptedBuffer = new Uint8Array(buffer);

		// Corrupt the checksum by changing the first byte
		corruptedBuffer[USTAR.checksum.offset] = corruptedBuffer[USTAR.checksum.offset] + 1;

		// Try to extract the corrupted archive
		await expect(unpackTar(corruptedBuffer)).rejects.toThrow("Invalid tar header checksum");
	});

	it("should reject tar entries with zero checksum when header has content", async () => {
		// Create a valid tar archive
		const { readable, controller } = createTarPacker();

		const fileStream = controller.add({
			name: "zero-checksum.txt",
			size: 6,
			type: "file"
		});

		const writer = fileStream.getWriter();
		await writer.write(new TextEncoder().encode("foobar"));
		await writer.close();

		controller.finalize();

		// Read and corrupt by zeroing the checksum
		const buffer = await new Response(readable).arrayBuffer();
		const corruptedBuffer = new Uint8Array(buffer);

		// Zero out the checksum field
		for (let i = 0; i < USTAR.checksum.size; i++) {
			corruptedBuffer[USTAR.checksum.offset + i] = 0;
		}

		// Try to extract
		await expect(unpackTar(corruptedBuffer)).rejects.toThrow("Invalid tar header checksum");
	});

	it("should reject tar entries with corrupted filename affecting checksum", async () => {
		// Create a valid tar archive
		const { readable, controller } = createTarPacker();

		const fileStream = controller.add({
			name: "filename.txt",
			size: 7,
			type: "file"
		});

		const writer = fileStream.getWriter();
		await writer.write(new TextEncoder().encode("content"));
		await writer.close();

		controller.finalize();

		// Read and corrupt the filename (which should make checksum invalid)
		const buffer = await new Response(readable).arrayBuffer();
		const corruptedBuffer = new Uint8Array(buffer);

		// Change the first character of the filename
		corruptedBuffer[USTAR.name.offset] = corruptedBuffer[USTAR.name.offset] + 1;

		// Try to extract
		await expect(unpackTar(corruptedBuffer)).rejects.toThrow("Invalid tar header checksum");
	});

	it("should reject tar entries with corrupted file size affecting checksum", async () => {
		// Create a valid tar archive
		const { readable, controller } = createTarPacker();

		const fileStream = controller.add({
			name: "sizetest.txt",
			size: 8,
			type: "file"
		});

		const writer = fileStream.getWriter();
		await writer.write(new TextEncoder().encode("sizebyte"));
		await writer.close();

		controller.finalize();

		// Read and corrupt the size field
		const buffer = await new Response(readable).arrayBuffer();
		const corruptedBuffer = new Uint8Array(buffer);

		// Corrupt one byte in the size field
		corruptedBuffer[USTAR.size.offset] = corruptedBuffer[USTAR.size.offset] + 1;

		// Try to extract
		await expect(unpackTar(corruptedBuffer)).rejects.toThrow("Invalid tar header checksum");
	});

	it("should handle multiple entries where only one has corrupted checksum", async () => {
		// Create a valid tar archive with multiple entries
		const { readable, controller } = createTarPacker();

		// First entry (will remain valid)
		const file1Stream = controller.add({
			name: "valid.txt",
			size: 5,
			type: "file"
		});
		let writer = file1Stream.getWriter();
		await writer.write(new TextEncoder().encode("valid"));
		await writer.close();

		// Second entry (will be corrupted)
		const file2Stream = controller.add({
			name: "corrupt.txt",
			size: 7,
			type: "file"
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
		corruptedBuffer[secondChecksumOffset] = corruptedBuffer[secondChecksumOffset] + 1;

		// The entire extraction should fail when encountering the corrupted second entry
		await expect(unpackTar(corruptedBuffer)).rejects.toThrow("Invalid tar header checksum");
	});

	it("should reject directory entries with corrupted checksums", async () => {
		// Create a tar archive with a directory
		const { readable, controller } = createTarPacker();

		const dirStream = controller.add({
			name: "corruptdir/",
			type: "directory",
			size: 0
		});
		await dirStream.close();

		controller.finalize();

		// Read and corrupt the checksum
		const buffer = await new Response(readable).arrayBuffer();
		const corruptedBuffer = new Uint8Array(buffer);

		// Corrupt the checksum
		corruptedBuffer[USTAR.checksum.offset] = corruptedBuffer[USTAR.checksum.offset] + 1;

		// Try to extract
		await expect(unpackTar(corruptedBuffer)).rejects.toThrow("Invalid tar header checksum");
	});
});
