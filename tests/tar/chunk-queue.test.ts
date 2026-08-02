import { describe, expect, it } from "vitest";
import { createChunkQueue } from "../../src/tar/chunk-queue";

describe("chunk queue", () => {
	it("ignores empty chunks", () => {
		const queue = createChunkQueue();
		queue.push(new Uint8Array(0));
		expect(queue.available()).toBe(0);
	});

	it("returns empty results for zero bytes and null on underflow", () => {
		const queue = createChunkQueue();
		queue.push(Uint8Array.of(1, 2));

		expect(queue.peek(0)).toEqual(new Uint8Array(0));
		expect(queue.pull(0)).toEqual(new Uint8Array(0));
		expect(queue.peek(3)).toBeNull();
		expect(queue.pull(3)).toBeNull();
		expect(queue.available()).toBe(2);
	});

	it("returns the original chunk when a pull fits its head", () => {
		const queue = createChunkQueue();
		const chunk = Uint8Array.of(1, 2, 3);
		queue.push(chunk);

		expect(queue.pull(chunk.length)).toBe(chunk);
	});

	it("feeds available segments until the callback applies backpressure", () => {
		const queue = createChunkQueue();
		queue.push(Uint8Array.of(1, 2));
		queue.push(Uint8Array.of(3, 4));
		queue.push(Uint8Array.of(5, 6));
		const segments: Uint8Array[] = [];

		const fed = queue.pull(100, (segment) => {
			segments.push(Uint8Array.from(segment));
			return segments.length < 2;
		});

		expect(fed).toBe(4);
		expect(segments).toEqual([Uint8Array.of(1, 2), Uint8Array.of(3, 4)]);
		expect(queue.pull(2)).toEqual(Uint8Array.of(5, 6));
	});

	it("feeds only the requested prefix of the final segment", () => {
		const queue = createChunkQueue();
		queue.push(Uint8Array.of(1, 2));
		queue.push(Uint8Array.of(3, 4));
		const segments: Uint8Array[] = [];

		const fed = queue.pull(3, (segment) => {
			segments.push(Uint8Array.from(segment));
			return true;
		});

		expect(fed).toBe(3);
		expect(segments).toEqual([Uint8Array.of(1, 2), Uint8Array.of(3)]);
		expect(queue.pull(1)).toEqual(Uint8Array.of(4));
	});

	it("feeds nothing for a zero-byte request", () => {
		const queue = createChunkQueue();
		queue.push(Uint8Array.of(1));
		let called = false;

		expect(
			queue.pull(0, () => {
				called = true;
				return true;
			}),
		).toBe(0);
		expect(called).toBe(false);
		expect(queue.available()).toBe(1);
	});

	it("rejects discarding more bytes than are available", () => {
		const queue = createChunkQueue();
		queue.push(Uint8Array.of(1));

		expect(() => queue.discard(2)).toThrow("Too many bytes consumed");
		expect(queue.available()).toBe(1);
	});
});
