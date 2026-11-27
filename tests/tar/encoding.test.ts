import { describe, expect, it } from "vitest";
import {
	decoder,
	encoder,
	readNumeric,
	readOctal,
	readString,
	writeOctal,
	writeString,
} from "../../src/tar/encoding";

describe("tar field encoding", () => {
	it("truncates strings to the selected field and buffer bounds", () => {
		const buffer = new Uint8Array(5);
		writeString(buffer, 0, 10, "hello world");
		expect(decoder.decode(buffer)).toBe("hello");
	});

	it("leaves a string field unchanged for an absent value", () => {
		const buffer = new Uint8Array(5).fill(0xaa);
		writeString(buffer, 0, buffer.length, undefined);
		expect(buffer).toEqual(new Uint8Array(5).fill(0xaa));
	});

	it.each([
		[encoder.encode("hello\0world"), "hello"],
		[encoder.encode("hello"), "hello"],
		[encoder.encode("\0hello"), ""],
	] as const)("reads string termination", (buffer, expected) => {
		expect(readString(buffer, 0, buffer.length)).toBe(expected);
	});

	it("leaves an octal field unchanged for an absent value", () => {
		const buffer = new Uint8Array(12).fill(0xaa);
		writeOctal(buffer, 0, buffer.length, undefined);
		expect(buffer).toEqual(new Uint8Array(12).fill(0xaa));
	});

	it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects the non-octal value %s",
		(value) => {
			expect(() => writeOctal(new Uint8Array(8), 0, 8, value)).toThrow();
		},
	);

	it.each([
		["755 ", 0o755],
		["    \0", 0],
	] as const)("reads terminated octal fields", (value, expected) => {
		const buffer = encoder.encode(value);
		expect(readOctal(buffer, 0, buffer.length)).toBe(expected);
	});

	it("uses octal parsing for ordinary numeric fields", () => {
		const buffer = encoder.encode("0001755\0");
		expect(readNumeric(buffer, 0, buffer.length)).toBe(0o1755);
	});

	it("rejects a 12-byte field whose value exceeds 64 bits", () => {
		const field = new Uint8Array(12);
		field.set([0x80, 0, 0, 1]); // 2^64, with all eight low bytes zero.
		expect(() => readNumeric(field, 0, field.length)).toThrow(
			"TAR number too large",
		);
	});

	it("checks both safe integer limits for base-256 fields", () => {
		const field = new Uint8Array(8);
		function read(value: bigint) {
			new DataView(field.buffer).setBigInt64(0, value);
			field[0] |= 0x80;
			return readNumeric(field, 0, field.length);
		}

		const max = BigInt(Number.MAX_SAFE_INTEGER);
		expect(read(max)).toBe(Number.MAX_SAFE_INTEGER);
		expect(read(-max)).toBe(Number.MIN_SAFE_INTEGER);
		expect(() => read(max + 1n)).toThrow("TAR number too large");
		expect(() => read(-max - 1n)).toThrow("TAR number too large");
	});
});
