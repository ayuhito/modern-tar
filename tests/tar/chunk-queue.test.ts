/** biome-ignore-all lint/style/noNonNullAssertion: Asserted */
import { describe, expect, it } from "vitest";
import { createChunkQueue } from "../../src/tar/chunk-queue";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

describe("chunk queue", () => {
	describe("push and available", () => {
		it("should add a chunk and update available bytes", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("hello"));
			expect(queue.available()).toBe(5);
		});

		it("should ignore empty chunks", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("data"));
			queue.push(new Uint8Array(0));
			expect(queue.available()).toBe(4);
		});
	});

	describe("read", () => {
		it("should return null if not enough data is available", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("short"));
			expect(queue.pull(10)).toBeNull();
		});

		it("should return an empty array when reading 0 bytes", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("data"));
			const result = queue.pull(0);
			expect(result).toBeInstanceOf(Uint8Array);
			expect(result).toHaveLength(0);
			expect(queue.available()).toBe(4); // Should not consume anything
		});

		it("should read a portion of the first chunk (zero-copy)", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("hello world"));
			const result = queue.pull(5);

			expect(textDecoder.decode(result!)).toBe("hello");
			expect(queue.available()).toBe(6);
		});

		it("should read the entirety of the first chunk", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("chunk1"));
			queue.push(textEncoder.encode("chunk2"));
			const result = queue.pull(6);

			expect(textDecoder.decode(result!)).toBe("chunk1");
			expect(queue.available()).toBe(6);
		});

		it("should read data spanning multiple chunks (copy)", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("hello "));
			queue.push(textEncoder.encode("world!"));
			const result = queue.pull(10);

			expect(textDecoder.decode(result!)).toBe("hello worl");
			expect(queue.available()).toBe(2);
		});

		it("should handle partial chunk consumption correctly", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("abcdef"));

			// Read first part
			let result = queue.pull(2);
			expect(textDecoder.decode(result!)).toBe("ab");
			expect(queue.available()).toBe(4);

			// Read remaining part
			result = queue.pull(4);
			expect(textDecoder.decode(result!)).toBe("cdef");
			expect(queue.available()).toBe(0);
		});

		it("should handle reading exact chunk boundaries", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("123"));
			queue.push(textEncoder.encode("456"));
			queue.push(textEncoder.encode("789"));

			// Read exactly one chunk
			let result = queue.pull(3);
			expect(textDecoder.decode(result!)).toBe("123");
			expect(queue.available()).toBe(6);

			// Read spanning two chunks
			result = queue.pull(6);
			expect(textDecoder.decode(result!)).toBe("456789");
			expect(queue.available()).toBe(0);
		});
	});

	describe("feed", () => {
		it("should feed data from a single chunk", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("long chunk"));

			const chunks: Uint8Array[] = [];
			const fedBytes = queue.pull(4, (chunk) => {
				chunks.push(chunk);
				return true;
			});

			expect(fedBytes).toBe(4);
			expect(chunks).toHaveLength(1);
			expect(textDecoder.decode(chunks[0])).toBe("long");
			expect(queue.available()).toBe(6);
		});

		it("should feed data spanning multiple chunks", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("part1 "));
			queue.push(textEncoder.encode("part2"));

			const chunks: string[] = [];
			const fedBytes = queue.pull(9, (chunk) => {
				chunks.push(textDecoder.decode(chunk));
				return true;
			});

			expect(fedBytes).toBe(9);
			expect(chunks).toEqual(["part1 ", "par"]);
			expect(queue.available()).toBe(2);
		});

		it("should respect backpressure from the callback", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("stop"));
			queue.push(textEncoder.encode("here"));

			const chunks: string[] = [];
			let calls = 0;
			const fedBytes = queue.pull(8, (chunk) => {
				calls++;
				chunks.push(textDecoder.decode(chunk));
				return false; // Signal to stop
			});

			expect(calls).toBe(1);
			expect(fedBytes).toBe(4); // "stop" was fed and consumed
			expect(chunks).toEqual(["stop"]);
			expect(queue.available()).toBe(4); // Only "here" remains
		});

		it("should not feed more bytes than available", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("short"));

			let fedData = "";
			const fedBytes = queue.pull(100, (chunk) => {
				fedData += textDecoder.decode(chunk);
				return true;
			});

			expect(fedBytes).toBe(5);
			expect(fedData).toBe("short");
			expect(queue.available()).toBe(0);
		});

		it("should handle feed with 0 bytes requested", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("data"));

			let callCount = 0;
			const fedBytes = queue.pull(0, () => {
				callCount++;
				return true;
			});

			expect(fedBytes).toBe(0);
			expect(callCount).toBe(0);
			expect(queue.available()).toBe(4);
		});

		it("should handle backpressure in the middle of feeding", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("123"));
			queue.push(textEncoder.encode("456"));
			queue.push(textEncoder.encode("789"));

			const chunks: string[] = [];
			let callCount = 0;
			const fedBytes = queue.pull(9, (chunk) => {
				callCount++;
				chunks.push(textDecoder.decode(chunk));
				// Stop after second call
				return callCount < 2;
			});

			expect(callCount).toBe(2);
			expect(fedBytes).toBe(6); // "123" + "456" were both fed and consumed
			expect(chunks).toEqual(["123", "456"]);
			expect(queue.available()).toBe(3); // Only "789" remains
		});
	});

	describe("peek", () => {
		it("should return null if not enough data is available", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("short"));
			expect(queue.peek(10)).toBeNull();
		});

		it("should return an empty array when peeking 0 bytes", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("data"));
			const result = queue.peek(0);
			expect(result).toBeInstanceOf(Uint8Array);
			expect(result).toHaveLength(0);
			expect(queue.available()).toBe(4); // Should not consume anything
		});

		it("should peek data from first chunk without consuming", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("hello world"));

			const result = queue.peek(5);
			expect(textDecoder.decode(result!)).toBe("hello");
			expect(queue.available()).toBe(11); // Data should still be there

			// Peek again should return the same data
			const result2 = queue.peek(5);
			expect(textDecoder.decode(result2!)).toBe("hello");
			expect(queue.available()).toBe(11);
		});
	});

	describe("consume", () => {
		it("should throw error when consuming more bytes than available", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("short"));

			expect(() => queue.discard(10)).toThrow("Too many bytes consumed");
		});

		it("should handle consuming 0 bytes", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("data"));

			queue.discard(0);
			expect(queue.available()).toBe(4); // Nothing should change
		});

		it("should consume partial chunk correctly", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("hello world"));

			queue.discard(6); // Consume "hello "
			expect(queue.available()).toBe(5);

			const remaining = queue.pull(5);
			expect(textDecoder.decode(remaining!)).toBe("world");
		});

		it("should consume data spanning multiple chunks", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("hello "));
			queue.push(textEncoder.encode("world!"));

			queue.discard(10); // Consume "hello worl"
			expect(queue.available()).toBe(2);

			const remaining = queue.pull(2);
			expect(textDecoder.decode(remaining!)).toBe("d!");
		});
	});

	describe("peek and consume combinations", () => {
		it("should work together like read", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("hello "));
			queue.push(textEncoder.encode("world!"));

			// Use peek + consume
			const peeked = queue.peek(8);
			expect(textDecoder.decode(peeked!)).toBe("hello wo");
			queue.discard(8);
			expect(queue.available()).toBe(4);

			// Compare with read on fresh queue
			const queue2 = createChunkQueue();
			queue2.push(textEncoder.encode("hello "));
			queue2.push(textEncoder.encode("world!"));
			const read = queue2.pull(8);
			expect(textDecoder.decode(read!)).toBe("hello wo");
			expect(queue2.available()).toBe(4);

			// Both queues should have same state
			expect(queue.available()).toBe(queue2.available());
		});

		it("should handle multiple peek/consume cycles", () => {
			const queue = createChunkQueue();
			queue.push(textEncoder.encode("abcdefghijk"));

			// First cycle: peek 3, consume 2
			let peeked = queue.peek(3);
			expect(textDecoder.decode(peeked!)).toBe("abc");
			queue.discard(2);
			expect(queue.available()).toBe(9);

			// Second cycle: peek 4, consume 3
			peeked = queue.peek(4);
			expect(textDecoder.decode(peeked!)).toBe("cdef");
			queue.discard(3);
			expect(queue.available()).toBe(6);

			// Third cycle: peek 2, consume the remaining 6
			peeked = queue.peek(2);
			expect(textDecoder.decode(peeked!)).toBe("fg");
			queue.discard(6);
			expect(queue.available()).toBe(0);
		});
	});

	describe("edge cases and error conditions", () => {
		it("should handle empty queue reads", () => {
			const queue = createChunkQueue();
			expect(queue.pull(1)).toBeNull();
			expect(queue.pull(0)).toEqual(new Uint8Array(0));
			expect(queue.available()).toBe(0);
		});

		it("should handle empty queue feeds", () => {
			const queue = createChunkQueue();
			let callCount = 0;
			const fedBytes = queue.pull(10, () => {
				callCount++;
				return true;
			});

			expect(fedBytes).toBe(0);
			expect(callCount).toBe(0);
		});

		it("should handle single byte operations", () => {
			const queue = createChunkQueue();
			queue.push(new Uint8Array([65, 66, 67])); // "ABC"

			expect(textDecoder.decode(queue.pull(1)!)).toBe("A");
			expect(textDecoder.decode(queue.pull(1)!)).toBe("B");
			expect(textDecoder.decode(queue.pull(1)!)).toBe("C");
			expect(queue.pull(1)).toBeNull();
		});

		it("should handle large chunks", () => {
			const queue = createChunkQueue();
			const largeChunk = new Uint8Array(1024 * 1024); // 1MB
			largeChunk.fill(65); // Fill with 'A'

			queue.push(largeChunk);
			expect(queue.available()).toBe(1024 * 1024);

			const result = queue.pull(1024 * 1024);
			expect(result).toHaveLength(1024 * 1024);
			expect(result![0]).toBe(65);
			expect(result![result!.length - 1]).toBe(65);
		});

		it("should maintain performance with many small reads", () => {
			const queue = createChunkQueue();
			const data = "The quick brown fox jumps over the lazy dog";
			queue.push(textEncoder.encode(data));

			let result = "";
			while (queue.available() > 0) {
				const byte = queue.pull(1);
				if (byte) result += textDecoder.decode(byte);
			}

			expect(result).toBe(data);
		});
	});
});
