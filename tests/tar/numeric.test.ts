import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect } from "vitest";
import { unpackTar as unpackTarFS } from "../../src/fs";
import { writeChecksum } from "../../src/tar/checksum";
import { USTAR_SIZE_OFFSET, USTAR_SIZE_SIZE } from "../../src/tar/constants";
import { createTarHeader } from "../../src/tar/header";
import { createUnpacker } from "../../src/tar/unpacker";
import { createTarDecoder, packTar, unpackTar } from "../../src/web";
import { streamFromChunks } from "../helpers/bytes";
import { it } from "../helpers/test";

function malformedHeader(type: "file" | "pax-header", digit: string) {
	const header = createTarHeader({ name: "invalid", size: 0, type });
	header.fill(0, USTAR_SIZE_OFFSET, USTAR_SIZE_OFFSET + USTAR_SIZE_SIZE);
	header[USTAR_SIZE_OFFSET] = digit.charCodeAt(0);
	writeChecksum(header);
	return header;
}

describe("malformed octal sizes", () => {
	it.each(["/", "8", "9", ":"])(
		"rejects or consumes invalid headers containing %s without entering body state",
		(digit) => {
			for (const type of ["file", "pax-header"] as const) {
				for (const strict of [false, true]) {
					const unpacker = createUnpacker({ strict });
					for (let i = 0; i < 16; i++) {
						unpacker.write(malformedHeader(type, digit));
						if (strict) {
							expect(() => unpacker.readHeader()).toThrow();
							break;
						}
						expect(unpacker.readHeader()).toBeNull();
						expect(unpacker.isEntryActive()).toBe(false);
						expect(unpacker.available()).toBe(0);
					}
				}
			}
		},
	);

	it("rejects a strict streaming write before the source closes", async () => {
		const decoder = createTarDecoder({ strict: true });
		const writer = decoder.writable.getWriter();
		const reader = decoder.readable.getReader();
		await Promise.all([
			expect(writer.write(malformedHeader("file", "/"))).rejects.toThrow(),
			expect(reader.read()).rejects.toThrow(),
		]);
	});

	it("continues to the next valid entry in non-strict buffered and streaming decoders", async () => {
		const valid = await packTar([
			{ header: { name: "valid", size: 2 }, body: "ok" },
		]);
		const invalid = malformedHeader("file", "/");
		for (const input of [
			new Uint8Array([...invalid, ...valid]),
			streamFromChunks([invalid, valid]),
		]) {
			const entries = await unpackTar(input);
			expect(entries.map(({ header }) => header.name)).toEqual(["valid"]);
			expect(entries[0].data).toEqual(new TextEncoder().encode("ok"));
		}
	});

	it.for([false, true])(
		"handles malformed sizes in filesystem extraction with strict=%s",
		async (strict, { tmpDir }) => {
			const valid = await packTar([
				{ header: { name: "valid", size: 2 }, body: "ok" },
			]);
			const extraction = pipeline(
				Readable.from([malformedHeader("file", "/"), valid]),
				unpackTarFS(tmpDir, { strict }),
			);
			if (strict) {
				await expect(extraction).rejects.toThrow("Invalid tar number.");
				expect(await readdir(tmpDir)).toEqual([]);
			} else {
				await extraction;
				expect(await readdir(tmpDir)).toEqual(["valid"]);
				expect(await readFile(join(tmpDir, "valid"), "utf8")).toBe("ok");
			}
		},
	);
});
