import { describe, expect, it } from "vitest";
import { normalizeBody } from "../../src/tar/body";
import {
	decoder,
	encoder,
	readNumeric,
	readOctal,
	readString,
	writeOctal,
	writeString,
} from "../../src/tar/encoding";
import { streamToBuffer } from "../../src/web/stream-utils";

describe("tar utilities", () => {
	describe("string utilities", () => {
		describe("writeString", () => {
			it("writes string to buffer at specified offset", () => {
				const buffer = new Uint8Array(20);
				writeString(buffer, 5, 10, "hello");

				expect(decoder.decode(buffer.subarray(5, 15))).toBe(
					"hello\x00\x00\x00\x00\x00",
				);
			});

			it("truncates string if too long", () => {
				const buffer = new Uint8Array(10);
				writeString(buffer, 0, 5, "hello world");

				expect(decoder.decode(buffer.subarray(0, 5))).toBe("hello");
			});

			it("handles undefined value", () => {
				const buffer = new Uint8Array(10);
				writeString(buffer, 0, 5, undefined);

				expect(buffer.subarray(0, 5)).toEqual(new Uint8Array(5));
			});
		});

		describe("readString", () => {
			it("reads null-terminated string", () => {
				const buffer = new Uint8Array([
					0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x77, 0x6f, 0x72, 0x6c,
				]);
				const result = readString(buffer, 0, 10);

				expect(result).toBe("hello");
			});

			it("reads entire size when no null terminator", () => {
				const buffer = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
				const result = readString(buffer, 0, 5);

				expect(result).toBe("hello");
			});

			it("handles empty string", () => {
				const buffer = new Uint8Array([0x00, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
				const result = readString(buffer, 0, 6);

				expect(result).toBe("");
			});
		});
	});

	describe("octal utilities", () => {
		describe("writeOctal", () => {
			it("writes octal number with zero padding", () => {
				const buffer = new Uint8Array(12);
				writeOctal(buffer, 0, 12, 755);

				// 755 in octal is "1363", padded to 11 chars (size-1) = "00000001363"
				expect(decoder.decode(buffer.subarray(0, 11))).toBe("00000001363");
				expect(buffer[11]).toBe(0); // NUL terminator
			});

			it("handles undefined value", () => {
				const buffer = new Uint8Array(12);
				buffer.fill(0xff); // Fill with non-zero to test
				writeOctal(buffer, 0, 12, undefined);

				// Should remain unchanged
				expect(buffer).toEqual(new Uint8Array(12).fill(0xff));
			});
		});

		describe("readOctal", () => {
			it("handles space-terminated octal", () => {
				const buffer = encoder.encode("755 ");
				const result = readOctal(buffer, 0, 4);

				expect(result).toBe(0o755);
			});

			it("returns 0 for empty or invalid octal", () => {
				const buffer = encoder.encode("    \x00");
				const result = readOctal(buffer, 0, 5);

				expect(result).toBe(0);
			});
		});
	});

	describe("body normalization", () => {
		describe("normalizeBody", () => {
			it("converts string to Uint8Array", async () => {
				const result = await normalizeBody("hello");

				expect(result).toBeInstanceOf(Uint8Array);
				expect(decoder.decode(result)).toBe("hello");
			});

			it("passes through Uint8Array unchanged", async () => {
				const input = new Uint8Array([1, 2, 3, 4]);
				const result = await normalizeBody(input);

				expect(result).toBe(input); // Same reference
			});

			it("handles empty string", async () => {
				const result = await normalizeBody("");

				expect(result).toBeInstanceOf(Uint8Array);
				expect(result.length).toBe(0);
			});

			it("handles unicode strings", async () => {
				const result = await normalizeBody("café");

				expect(result).toBeInstanceOf(Uint8Array);
				expect(decoder.decode(result)).toBe("café");
			});

			it("handles undefined as empty array", async () => {
				const result = await normalizeBody(undefined);

				expect(result).toBeInstanceOf(Uint8Array);
				expect(result.length).toBe(0);
			});
		});
	});

	describe("stream utilities", () => {
		describe("streamToBuffer", () => {
			it("converts ReadableStream to Uint8Array", async () => {
				const data = encoder.encode("hello world");
				const stream = new ReadableStream({
					start(controller) {
						controller.enqueue(data);
						controller.close();
					},
				});

				const result = await streamToBuffer(stream);

				expect(result).toBeInstanceOf(Uint8Array);
				expect(decoder.decode(result)).toBe("hello world");
			});

			it("handles chunked streams", async () => {
				const chunks = [
					encoder.encode("hello "),
					encoder.encode("world"),
					encoder.encode("!"),
				];

				const stream = new ReadableStream({
					start(controller) {
						for (const chunk of chunks) {
							controller.enqueue(chunk);
						}
						controller.close();
					},
				});

				const result = await streamToBuffer(stream);

				expect(decoder.decode(result)).toBe("hello world!");
			});

			it("handles empty streams", async () => {
				const stream = new ReadableStream({
					start(controller) {
						controller.close();
					},
				});

				const result = await streamToBuffer(stream);

				expect(result).toBeInstanceOf(Uint8Array);
				expect(result.length).toBe(0);
			});

			it("handles large streams", async () => {
				const largeData = "x".repeat(100000);
				const stream = new ReadableStream({
					start(controller) {
						controller.enqueue(encoder.encode(largeData));
						controller.close();
					},
				});

				const result = await streamToBuffer(stream);

				expect(result.length).toBe(100000);
				expect(decoder.decode(result)).toBe(largeData);
			});

			it("handles stream errors", async () => {
				const stream = new ReadableStream({
					start(controller) {
						controller.error(new Error("Stream error"));
					},
				});

				await expect(streamToBuffer(stream)).rejects.toThrow("Stream error");
			});
		});
	});

	describe("edge cases and security", () => {
		it("handles buffer bounds correctly in writeString", () => {
			const buffer = new Uint8Array(5);
			// This should not write beyond buffer bounds
			writeString(buffer, 0, 10, "hello world");

			// Should only write up to buffer size
			expect(decoder.decode(buffer)).toBe("hello");
		});

		it("handles buffer bounds correctly in readString", () => {
			const buffer = encoder.encode("hello");
			// Reading beyond buffer should work gracefully
			const result = readString(buffer, 0, 100);

			expect(result).toBe("hello");
		});
	});

	describe("readNumeric", () => {
		it("falls back to octal parsing for normal numbers", () => {
			const buffer = encoder.encode("0001755\x00");
			const result = readNumeric(buffer, 0, 8);
			expect(result).toBe(0o1755);
		});

		it("throws error for numbers larger than MAX_SAFE_INTEGER", () => {
			const buffer = new Uint8Array(8).fill(0xff);
			expect(() => readNumeric(buffer, 0, 8)).toThrow("TAR number too large");
		});
	});
});
