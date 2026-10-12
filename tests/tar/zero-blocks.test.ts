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

	it.each([false, true])(
		"discards trailers immediately (strict: %s)",
		(strict) => {
			const unpacker = createUnpacker({ strict });
			unpacker.write(new Uint8Array(BLOCK_SIZE * 2 + 3));
			unpacker.write(new Uint8Array(17));
			expect(unpacker.readHeader()).toBeUndefined();
			expect(unpacker.available()).toBe(0);

			const trailer = new Uint8Array(64 * 1024).fill(strict ? 0 : 1);
			for (let i = 0; i < 256; i++) {
				unpacker.write(trailer);
				expect(unpacker.available()).toBe(0);
			}
			unpacker.end();
			expect(() => unpacker.finish()).not.toThrow();
			expect(() => unpacker.write(trailer)).toThrow("Archive already ended");
		},
	);

	it.each(["same chunk", "queued chunk", "later write"])(
		"rejects nonzero strict trailers before source closure: %s",
		(position) => {
			const unpacker = createUnpacker({ strict: true });
			const eof = new Uint8Array(BLOCK_SIZE * 2);
			if (position === "same chunk") {
				const chunk = new Uint8Array(eof.length + 1);
				chunk[chunk.length - 1] = 1;
				unpacker.write(chunk);
			} else {
				unpacker.write(eof);
				if (position === "later write") {
					unpacker.readHeader();
					expect(() => unpacker.write(Uint8Array.of(1))).toThrow("Invalid EOF");
					return;
				}
				unpacker.write(Uint8Array.of(1));
			}
			expect(() => unpacker.readHeader()).toThrow("Invalid EOF");
		},
	);

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
