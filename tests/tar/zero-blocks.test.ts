import { describe, expect, it } from "vitest";
import { BLOCK_SIZE } from "../../src/tar/constants";
import { createUnpacker } from "../../src/tar/unpacker";
import { packTar, unpackTar } from "../../src/web";

describe("tar zero blocks", () => {
	it("accepts unaligned zero blocks", () => {
		const unpacker = createUnpacker();
		const buffer = new ArrayBuffer(BLOCK_SIZE * 3 + 1);
		const unaligned = new Uint8Array(buffer, 1, BLOCK_SIZE * 3);

		expect(() => {
			unpacker.write(unaligned);
			unpacker.end();
		}).not.toThrow();
	});

	it("requires two EOF blocks only in strict mode", async () => {
		const archive = await packTar([
			{ header: { name: "file.txt", size: 1 }, body: "x" },
		]);
		const singleEof = archive.subarray(0, archive.length - BLOCK_SIZE);

		await expect(unpackTar(singleEof, { strict: true })).rejects.toThrow(
			"Tar archive is truncated",
		);
		await expect(unpackTar(singleEof, { strict: false })).resolves.toHaveLength(
			1,
		);
	});

	it("rejects non-zero data after the EOF marker in strict mode", async () => {
		const archive = await packTar([
			{ header: { name: "file.txt", size: 1 }, body: "x" },
		]);
		const trailing = new Uint8Array(archive.length + 1);
		trailing.set(archive);
		trailing[archive.length] = 1;

		await expect(unpackTar(trailing, { strict: true })).rejects.toThrow(
			"Invalid EOF",
		);
	});

	it("rejects archives that end during a header in strict mode", async () => {
		const archive = await packTar([
			{ header: { name: "file.txt", size: 1 }, body: "x" },
		]);
		await expect(
			unpackTar(archive.subarray(0, 200), { strict: true }),
		).rejects.toThrow("Tar archive is truncated");
	});
});
