import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
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

const offsets = gs.integers({ minValue: 0, maxValue: 16 });

function writeStringReference(
	view: Uint8Array,
	offset: number,
	size: number,
	value?: string,
) {
	if (value) encoder.encodeInto(value, view.subarray(offset, offset + size));
}

function writeOctalReference(
	view: Uint8Array,
	offset: number,
	size: number,
	value: number,
) {
	const octalString = value.toString(8).padStart(size - 1, "0");
	encoder.encodeInto(octalString, view.subarray(offset, offset + size - 1));
}

describe("tar encoding properties", () => {
	it("round-trips strings that fit in their field", () =>
		hegel.test((tc) => {
			const value = tc.draw(gs.text({ excludeCharacters: "\0", maxSize: 64 }));
			const offset = tc.draw(offsets);
			const size = encoder.encode(value).length + 1;
			// Non-zero guard bytes prove the writer stays within the selected field.
			const buffer = new Uint8Array(offset + size + 16).fill(0xaa);
			buffer.fill(0, offset, offset + size);

			writeString(buffer, offset, size, value);

			expect(readString(buffer, offset, size)).toBe(value);
			expect(buffer.subarray(0, offset)).toEqual(
				new Uint8Array(offset).fill(0xaa),
			);
			expect(buffer.subarray(offset + size)).toEqual(
				new Uint8Array(16).fill(0xaa),
			);
		}));

	it("matches TextEncoder for arbitrary string field boundaries", () =>
		hegel.test((tc) => {
			const value = tc.draw(gs.text({ maxSize: 64 }));
			const offset = tc.draw(offsets);
			const size = tc.draw(gs.integers({ minValue: 0, maxValue: 64 }));
			const actual = new Uint8Array(offset + size + 16).fill(0xaa);
			const expected = actual.slice();

			writeString(actual, offset, size, value);
			writeStringReference(expected, offset, size, value);

			expect(actual).toEqual(expected);
		}));

	it("round-trips octal values that fit in their field", () =>
		hegel.test((tc) => {
			const size = tc.draw(gs.integers({ minValue: 2, maxValue: 12 }));
			const value = tc.draw(
				gs.integers({ minValue: 0, maxValue: 8 ** (size - 1) - 1 }),
			);
			const offset = tc.draw(offsets);
			// Non-zero guard bytes prove the writer stays within the selected field.
			const buffer = new Uint8Array(offset + size + 16).fill(0xaa);
			buffer.fill(0, offset, offset + size);

			writeOctal(buffer, offset, size, value);

			expect(decoder.decode(buffer.subarray(offset, offset + size - 1))).toBe(
				value.toString(8).padStart(size - 1, "0"),
			);
			expect(buffer[offset + size - 1]).toBe(0);
			expect(readOctal(buffer, offset, size)).toBe(value);
		}));

	it("preserves formatted bytes when octal values overflow their field", () =>
		hegel.test((tc) => {
			const size = tc.draw(gs.integers({ minValue: 2, maxValue: 12 }));
			const value = tc.draw(
				gs.integers({
					minValue: 8 ** (size - 1),
					maxValue: Number.MAX_SAFE_INTEGER,
				}),
			);
			const offset = tc.draw(offsets);
			const actual = new Uint8Array(offset + size + 16).fill(0xaa);
			const expected = actual.slice();
			actual.fill(0, offset, offset + size);
			expected.fill(0, offset, offset + size);

			writeOctal(actual, offset, size, value);
			writeOctalReference(expected, offset, size, value);

			expect(actual).toEqual(expected);
		}));

	it("decodes positive base-256 values", () =>
		hegel.test((tc) => {
			const value = tc.draw(
				gs.integers({ minValue: 0, maxValue: Number.MAX_SAFE_INTEGER }),
			);
			const offset = tc.draw(offsets);
			const size = 8;
			const buffer = new Uint8Array(offset + size);
			// Use the platform encoder as an independent oracle for the field bytes.
			new DataView(buffer.buffer).setBigUint64(offset, BigInt(value));
			buffer[offset] |= 0x80;

			expect(readNumeric(buffer, offset, size)).toBe(value);
		}));
});
