import { readdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect } from "vitest";
import { unpackTar as unpackTarFS } from "../../src/fs";
import { writeChecksum } from "../../src/tar/checksum";
import {
	USTAR_MTIME_OFFSET,
	USTAR_SIZE_OFFSET,
	USTAR_SIZE_SIZE,
} from "../../src/tar/constants";
import { createTarHeader } from "../../src/tar/header";
import { createUnpacker } from "../../src/tar/unpacker";
import { createTarDecoder, packTar, unpackTar } from "../../src/web";
import { streamFromChunks } from "../helpers/bytes";
import { it } from "../helpers/test";

function malformedHeader(type: "file" | "pax-header", digit: string) {
	const header = createTarHeader({ name: "invalid", size: 0, type });
	const byte = digit.charCodeAt(0);
	header.fill(byte, USTAR_SIZE_OFFSET, USTAR_SIZE_OFFSET + USTAR_SIZE_SIZE);
	writeChecksum(header);
	return header;
}

describe("malformed numeric fields", () => {
	// An all-0xff size encodes -1 in GNU base-256.
	it.each(["/", "8", "9", ":", "\x81", "\xff"])(
		"rejects an invalid size field %j before entering body state",
		(digit) => {
			for (const type of ["file", "pax-header"] as const) {
				for (const strict of [false, true]) {
					const unpacker = createUnpacker({ strict });
					unpacker.write(malformedHeader(type, digit));
					expect(() => unpacker.readHeader()).toThrow();
					expect(unpacker.isEntryActive()).toBe(false);
				}
			}
		},
	);

	it("rejects an unreadable timestamp even when the size is valid", async () => {
		const header = createTarHeader({ name: "file", size: 0 });
		header[USTAR_MTIME_OFFSET] = "9".charCodeAt(0);
		writeChecksum(header);
		await expect(unpackTar(header)).rejects.toThrow("Invalid tar number.");
	});

	it.each([false, true])("rejects writes before EOF (%s)", async (strict) => {
		const decoder = createTarDecoder({ strict });
		const writer = decoder.writable.getWriter();
		const reader = decoder.readable.getReader();
		await Promise.all([
			expect(writer.write(malformedHeader("file", "/"))).rejects.toThrow(),
			expect(reader.read()).rejects.toThrow(),
		]);
	});

	it("rejects malformed sizes in buffered and streaming decoders", async () => {
		const valid = await packTar([
			{ header: { name: "valid", size: 2 }, body: "ok" },
		]);
		const invalid = malformedHeader("file", "/");
		for (const input of [
			new Uint8Array([...invalid, ...valid]),
			streamFromChunks([invalid, valid]),
		]) {
			await expect(unpackTar(input)).rejects.toThrow("Invalid tar number.");
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
			await expect(extraction).rejects.toThrow("Invalid tar number.");
			expect(await readdir(tmpDir)).toEqual([]);
		},
	);
});
