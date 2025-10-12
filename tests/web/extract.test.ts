import * as fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BLOCK_SIZE, USTAR_CHECKSUM_OFFSET } from "../../src/tar/constants";
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

const createBaseArchive = (
	entries: Parameters<typeof packTar>[0],
): Promise<Uint8Array> => {
	return packTar(entries);
};
describe("unpackTar", () => {
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
		expect(decoder.decode(entries[0].data)).toBe("i am file-1\n");
		expect(entries[1].header.name).toBe("file-2.txt");
		expect(decoder.decode(entries[1].data)).toBe("i am file-2\n");
	});

	it("extracts a tar with various entry types (directory, symlink)", async () => {
		const buffer = await fs.readFile(TYPES_TAR);
		const entries = await unpackTar(buffer);

		expect(entries).toHaveLength(2);
		const [dir, link] = entries;

		expect(dir.header.name).toBe("directory");
		expect(dir.header.type).toBe("directory");
		expect(dir.header.size).toBe(0);

		expect(link.header.name).toBe("directory-link");
		expect(link.header.type).toBe("symlink");
		expect(link.header.linkname).toBe("directory");
	});

	it("throws an error for an incomplete archive in strict mode", async () => {
		const buffer = await fs.readFile(INCOMPLETE_TAR);
		await expect(unpackTar(buffer, { strict: true })).rejects.toThrow(
			"Tar archive is truncated.",
		);
	});

	it("handles an incomplete archive gracefully in non-strict mode", async () => {
		const buffer = await fs.readFile(INCOMPLETE_TAR);
		const entries = await unpackTar(buffer, { strict: false });

		expect(entries).toHaveLength(1);
		expect(entries[0].header.name).toBe("file-1.txt");
	});

	it("should ignore extra data after the final null blocks in non-strict mode", async () => {
		const archive = await createBaseArchive([
			{ header: { name: "test.txt", type: "file", size: 5 }, body: "hello" },
		]);
		const extraData = new Uint8Array([1, 2, 3]);
		const combined = new Uint8Array(archive.length + extraData.length);
		combined.set(archive);
		combined.set(extraData, archive.length);

		const entries = await unpackTar(combined, { strict: false });
		expect(entries).toHaveLength(1);
		expect(entries[0].header.name).toBe("test.txt");
	});
});

describe("createTarDecoder", () => {
	it("rejects a stream with an invalid checksum in strict mode", async () => {
		const archive = await createBaseArchive([
			{ header: { name: "test.txt", type: "file", size: 0 }, body: "" },
		]);
		// Corrupt the checksum
		archive.set(encoder.encode("INVALID!"), USTAR_CHECKSUM_OFFSET);

		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(archive);
				controller.close();
			},
		});

		const decoder = createTarDecoder({ strict: true });
		await expect(
			stream.pipeThrough(decoder).getReader().read(),
		).rejects.toThrow("Invalid tar header checksum");
	});

	it("rejects a stream with unexpected data at the end in strict mode", async () => {
		const archive = await createBaseArchive([
			{ header: { name: "test.txt", type: "file", size: 1 }, body: "h" },
		]);
		const stream = new ReadableStream({
			start(controller) {
				// End the archive correctly, but then add extra junk data
				controller.enqueue(archive);
				controller.enqueue(new Uint8Array([1, 2, 3, 4]));
				controller.close();
			},
		});

		const decoder = createTarDecoder({ strict: true });
		const reader = stream.pipeThrough(decoder).getReader();
		await reader.read(); // Read the valid entry
		await expect(reader.read()).rejects.toThrow("Invalid EOF.");
	});

	it("rejects a stream truncated mid-entry in strict mode", async () => {
		const archive = await createBaseArchive([
			{
				header: { name: "test.txt", size: 10, type: "file" },
				body: "1234567890",
			},
		]);
		// Truncate the archive in the middle of the file's data block
		const truncated = archive.slice(0, BLOCK_SIZE + 5);

		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(truncated);
				controller.close();
			},
		});

		const decoder = createTarDecoder({ strict: true });
		await expect(
			stream.pipeThrough(decoder).pipeTo(new WritableStream()),
		).rejects.toThrow("Tar archive is truncated");
	});

	it("gracefully handles a stream truncated mid-entry in non-strict mode", async () => {
		const archive = await createBaseArchive([
			{
				header: { name: "test.txt", size: 10, type: "file" },
				body: "1234567890",
			},
		]);
		const truncated = archive.slice(0, BLOCK_SIZE + 5);

		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(truncated);
				controller.close();
			},
		});

		const decoder = createTarDecoder({ strict: false });
		const reader = stream.pipeThrough(decoder).getReader();

		const { value: entry } = await reader.read();
		expect(entry?.header.name).toBe("test.txt");

		if (!entry) throw new Error("Entry is undefined");

		const bodyReader = entry.body.getReader();
		const chunk1 = await bodyReader.read();
		expect(new TextDecoder().decode(chunk1.value)).toBe("12345"); // Read the 5 available bytes

		const chunk2 = await bodyReader.read();
		expect(chunk2.done).toBe(true); // Stream ends gracefully

		const finalRead = await reader.read();
		expect(finalRead.done).toBe(true);
	});
});

describe("spec compliance", () => {
	describe("USTAR Fields", () => {
		it("extracts a filename that is exactly 100 characters long", async () => {
			const longName = "a".repeat(100);
			const archive = await createBaseArchive([
				{ header: { name: longName, type: "file", size: 4 }, body: "test" },
			]);
			const [entry] = await unpackTar(archive);
			expect(entry.header.name).toBe(longName);
		});

		it("extracts a long name using the USTAR 'prefix' field", async () => {
			const buffer = await fs.readFile(LONG_NAME_TAR);
			const expectedName =
				"my/file/is/longer/than/100/characters/and/should/use/the/prefix/header/foobarbaz/foobarbaz/foobarbaz/foobarbaz/foobarbaz/foobarbaz/filename.txt";

			const [entry] = await unpackTar(buffer);
			expect(entry.header.name).toBe(expectedName);
		});
	});

	describe("PAX Extensions", () => {
		it("extracts a unicode name from a PAX header", async () => {
			const buffer = await fs.readFile(UNICODE_TAR);
			const [entry] = await unpackTar(buffer);

			expect(entry.header.name).toBe("høstål.txt");
			expect(entry.header.pax).toEqual({ path: "høstål.txt" });
			expect(decoder.decode(entry.data)).toBe("høllø\n");
		});

		it("extracts custom key-value attributes from a PAX header", async () => {
			const buffer = await fs.readFile(PAX_TAR);
			const [entry] = await unpackTar(buffer);

			expect(entry.header.name).toBe("pax.txt");
			expect(entry.header.pax).toEqual({ path: "pax.txt", special: "sauce" });
		});

		it("uses PAX 'size' attribute for files larger than USTAR limit", async () => {
			const hugeFileSize = "8804630528"; // ~8.2 GB
			const archive = await createBaseArchive([
				{
					header: {
						name: "huge.txt",
						type: "file",
						size: 11,
						pax: { size: hugeFileSize },
					},
					body: "placeholder",
				},
			]);

			const [entry] = await unpackTar(archive);
			expect(entry.header.size).toBe(parseInt(hugeFileSize, 10));
		});

		it("uses PAX for large file size via custom PAX attribute", async () => {
			const archive = await packTar([
				{
					header: {
						name: "test.txt",
						type: "file",
						size: 4,
						pax: { comment: "test comment" },
					},
					body: "test",
				},
			]);

			const [entry] = await unpackTar(archive);
			expect(entry.header.pax?.comment).toBe("test comment");
		});

		it("handles PAX with custom attributes", async () => {
			const archive = await packTar([
				{
					header: {
						name: "test.txt",
						type: "file",
						size: 4,
						pax: { "custom.attribute": "custom value" },
					},
					body: "test",
				},
			]);

			const [entry] = await unpackTar(archive);
			expect(entry.header.name).toBe("test.txt");
			expect(entry.header.pax?.["custom.attribute"]).toBe("custom value");
		});
	});

	describe("Archive Structure Edge Cases", () => {
		it("handles data after final null blocks in strict mode", async () => {
			const archive = await createBaseArchive([
				{ header: { name: "test.txt", size: 5, type: "file" }, body: "hello" },
			]);
			const extraData = new Uint8Array(100).fill(0xff);
			const archiveWithExtra = new Uint8Array(
				archive.length + extraData.length,
			);
			archiveWithExtra.set(archive);
			archiveWithExtra.set(extraData, archive.length);

			await expect(
				unpackTar(archiveWithExtra, { strict: true }),
			).rejects.toThrow(/Invalid EOF/);
		});

		it("handles archive ending with single null block", async () => {
			const archive = await createBaseArchive([
				{ header: { name: "test.txt", size: 5, type: "file" }, body: "hello" },
			]);
			const archiveWithOneEOF = archive.slice(0, archive.length - BLOCK_SIZE);

			await expect(
				unpackTar(archiveWithOneEOF, { strict: true }),
			).rejects.toThrow(/Tar archive is truncated/);

			const resultNonStrict = await unpackTar(archiveWithOneEOF, {
				strict: false,
			});
			expect(resultNonStrict).toHaveLength(1);
			expect(resultNonStrict[0].header.name).toBe("test.txt");
		});

		it("handles archive ending mid-header", async () => {
			const archive = await createBaseArchive([
				{ header: { name: "test.txt", size: 5, type: "file" }, body: "hello" },
			]);
			const truncatedArchive = archive.slice(0, 200);

			await expect(
				unpackTar(truncatedArchive, { strict: true }),
			).rejects.toThrow();
		});
	});
});
