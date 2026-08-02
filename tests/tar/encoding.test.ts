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

	it("rejects numeric fields above Number.MAX_SAFE_INTEGER", () => {
		expect(() => readNumeric(new Uint8Array(8).fill(0xff), 0, 8)).toThrow(
			"TAR number too large",
		);
	});
});
