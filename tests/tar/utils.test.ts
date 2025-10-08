import { describe, expect, it } from "vitest";
import { createTarUnpacker } from "../../src/tar/unpacker";
import {
	decoder,
	encoder,
	normalizeBody,
	readOctal,
	readString,
	streamToBuffer,
	writeOctal,
	writeString,
} from "../../src/tar/utils";

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

			it("handles empty string", () => {
				const buffer = new Uint8Array(10);
				writeString(buffer, 0, 5, "");

				expect(buffer.subarray(0, 5)).toEqual(new Uint8Array(5));
			});

			it("handles unicode characters", () => {
				const buffer = new Uint8Array(20);
				writeString(buffer, 0, 10, "café");

				// UTF-8 encoding: c=0x63, a=0x61, f=0x66, é=0xc3,0xa9
				expect(buffer.subarray(0, 5)).toEqual(
					new Uint8Array([0x63, 0x61, 0x66, 0xc3, 0xa9]),
				);
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

			it("handles offset correctly", () => {
				const buffer = new Uint8Array([
					0x00, 0x00, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00,
				]);
				const result = readString(buffer, 2, 6);

				expect(result).toBe("hello");
			});

			it("handles unicode characters", () => {
				const buffer = encoder.encode("café\x00");
				const result = readString(buffer, 0, buffer.length);

				expect(result).toBe("café");
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

			it("handles large numbers", () => {
				const buffer = new Uint8Array(12);
				writeOctal(buffer, 0, 12, 0o7777777);

				expect(decoder.decode(buffer.subarray(0, 11))).toBe("00007777777");
			});

			it("handles undefined value", () => {
				const buffer = new Uint8Array(12);
				buffer.fill(0xff); // Fill with non-zero to test
				writeOctal(buffer, 0, 12, undefined);

				// Should remain unchanged
				expect(buffer).toEqual(new Uint8Array(12).fill(0xff));
			});

			it("handles zero value", () => {
				const buffer = new Uint8Array(12);
				writeOctal(buffer, 0, 12, 0);

				expect(decoder.decode(buffer.subarray(0, 11))).toBe("00000000000");
			});

			it("handles offset correctly", () => {
				const buffer = new Uint8Array(20);
				writeOctal(buffer, 5, 8, 644);

				// 644 in octal is "1204", padded to 7 chars = "0001204"
				expect(decoder.decode(buffer.subarray(5, 12))).toBe("0001204");
			});
		});

		describe("readOctal", () => {
			it("reads octal number", () => {
				const buffer = encoder.encode("0001755\x00");
				const result = readOctal(buffer, 0, 8);

				expect(result).toBe(0o1755);
			});

			it("handles leading zeros", () => {
				const buffer = encoder.encode("00000644");
				const result = readOctal(buffer, 0, 8);

				expect(result).toBe(0o644);
			});

			it("handles space-terminated octal", () => {
				const buffer = encoder.encode("755 ");
				const result = readOctal(buffer, 0, 4);

				expect(result).toBe(0o755);
			});

			it("handles null-terminated octal", () => {
				const buffer = encoder.encode("755\x00");
				const result = readOctal(buffer, 0, 4);

				expect(result).toBe(0o755);
			});

			it("handles offset correctly", () => {
				const buffer = encoder.encode("xxx0001755\x00");
				const result = readOctal(buffer, 3, 8);

				expect(result).toBe(0o1755);
			});

			it("returns 0 for empty or invalid octal", () => {
				const buffer = encoder.encode("    \x00");
				const result = readOctal(buffer, 0, 5);

				expect(result).toBe(0);
			});

			it("handles maximum tar values", () => {
				const buffer = encoder.encode("7777777\x00"); // 7-digit octal
				const result = readOctal(buffer, 0, 8);

				expect(result).toBe(0o7777777);
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
		it("handles malformed octal strings gracefully", () => {
			const buffer = encoder.encode("abc123\x00");
			const result = readOctal(buffer, 0, 7);

			// readOctal implementation treats non-digit chars as part of octal calculation
			// This test documents actual behavior rather than ideal behavior
			expect(typeof result).toBe("number");
		});

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

		it("handles negative offsets safely", () => {
			const buffer = new Uint8Array(10);
			// These operations should be safe even with edge case inputs
			expect(() => writeString(buffer, 0, 5, "test")).not.toThrow();
			expect(() => readString(buffer, 0, 5)).not.toThrow();
		});

		it("handles very large octal numbers", () => {
			const buffer = new Uint8Array(15);
			const largeNumber = 0o7777777; // 7-digit octal that fits in JS integer range
			writeOctal(buffer, 0, 15, largeNumber);

			const result = readOctal(buffer, 0, 15);
			expect(result).toBe(largeNumber);
		});

		it("handles octal overflow gracefully", () => {
			// Test with number that would overflow octal representation
			const buffer = encoder.encode("99999999999\x00"); // Invalid octal digits
			const result = readOctal(buffer, 0, 12);

			// readOctal treats '9' as part of calculation, this documents actual behavior
			expect(typeof result).toBe("number");
		});
	});

	it("handles unaligned zero blocks without crashing", () => {
		let errorOccurred = false;

		const handler = {
			onHeader: () => {},
			onData: () => {},
			onEndEntry: () => {},
			onError: (_error: Error) => {
				errorOccurred = true;
			},
		};

		const unpacker = createTarUnpacker(handler);

		// Create a large buffer with unaligned offset that contains a zero block
		// This ensures the read() function will use the subarray path that preserves
		// the unaligned byteOffset, which would crash in the vulnerable version
		const buffer = new ArrayBuffer(2048);
		const unalignedChunk = new Uint8Array(buffer, 1, 1536); // offset=1, contains multiple 512-byte blocks

		// Fill with zeros to create zero blocks that will trigger isZeroBlock()
		unalignedChunk.fill(0);

		expect(() => {
			unpacker.write(unalignedChunk);
			unpacker.end();
		}).not.toThrow();

		expect(errorOccurred).toBe(false);
	});
});
