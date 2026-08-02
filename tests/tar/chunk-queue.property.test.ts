import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { createChunkQueue } from "../../src/tar/chunk-queue";

describe("chunk queue properties", () => {
	it("preserves bytes while wrapping, growing, and resetting", () =>
		hegel.test((tc) => {
			const bytes = tc.draw(gs.binary({ minSize: 356, maxSize: 356 }));
			const afterReset = tc.draw(gs.binary({ maxSize: 64 }));
			const queue = createChunkQueue();

			for (const byte of bytes.subarray(0, 200)) {
				queue.push(Uint8Array.of(byte));
			}

			expect(queue.pull(100)).toEqual(Uint8Array.from(bytes.subarray(0, 100)));

			for (const byte of bytes.subarray(200)) {
				queue.push(Uint8Array.of(byte));
			}

			const expected = Uint8Array.from(bytes.subarray(100));
			expect(queue.available()).toBe(expected.length);
			expect(queue.peek(expected.length)).toEqual(expected);
			expect(queue.available()).toBe(expected.length);
			expect(queue.pull(expected.length)).toEqual(expected);
			expect(queue.available()).toBe(0);

			queue.push(Uint8Array.from(afterReset));
			expect(queue.pull(afterReset.length)).toEqual(
				Uint8Array.from(afterReset),
			);
			expect(queue.available()).toBe(0);
		}));
});
