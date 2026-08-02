import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { createChunkQueue } from "../../src/tar/chunk-queue";

const queueCapacity = 256;
const initialChunks = 200;

describe("chunk queue properties", () => {
	it("behaves like one contiguous byte sequence", () =>
		hegel.test((tc) => {
			const chunks = tc.draw(
				gs.arrays(gs.binary({ maxSize: 64 }), { maxSize: 32 }),
			);
			const requests = tc.draw(
				gs.arrays(gs.integers({ minValue: 0, maxValue: 96 }), {
					maxSize: 64,
				}),
			);
			const queue = createChunkQueue();
			// Chunk boundaries are an implementation detail. This model concatenates
			// every pushed chunk, then applies the same operations to the remaining
			// bytes: peek reads without consuming, pull reads and consumes, and discard
			// only consumes. Requests past the end return null without consuming.
			let model = Uint8Array.from(chunks.flatMap((chunk) => Array.from(chunk)));
			for (const chunk of chunks) queue.push(Uint8Array.from(chunk));

			for (const [index, requested] of requests.entries()) {
				if (index % 3 === 0) {
					const expected =
						requested <= model.length ? model.slice(0, requested) : null;
					expect(queue.peek(requested)).toEqual(expected);
				} else if (index % 3 === 1) {
					const expected =
						requested <= model.length ? model.slice(0, requested) : null;
					expect(queue.pull(requested)).toEqual(expected);
					if (expected) model = model.slice(requested);
				} else {
					const discarded = requested % (model.length + 1);
					queue.discard(discarded);
					model = model.slice(discarded);
				}

				expect(queue.available()).toBe(model.length);
			}
		}));

	it("preserves bytes while wrapping, growing, and resetting", () =>
		hegel.test((tc) => {
			const consumed = tc.draw(
				gs.integers({ minValue: 1, maxValue: initialChunks - 1 }),
			);
			const bytes = tc.draw(
				gs.binary({
					minSize: queueCapacity + consumed,
					maxSize: queueCapacity + consumed,
				}),
			);
			const afterReset = tc.draw(gs.binary({ minSize: 1, maxSize: 64 }));

			// The ring reserves one slot, so the 256th live chunk forces growth.
			// Advancing the head first makes the second scenario wrap before growing.
			for (const consume of [0, consumed]) {
				const queue = createChunkQueue();
				const scenario = bytes.subarray(0, queueCapacity + consume);

				for (const byte of scenario.subarray(0, initialChunks)) {
					queue.push(Uint8Array.of(byte));
				}
				expect(queue.pull(consume)).toEqual(
					Uint8Array.from(scenario.subarray(0, consume)),
				);

				for (const byte of scenario.subarray(initialChunks)) {
					queue.push(Uint8Array.of(byte));
				}

				const expected = Uint8Array.from(scenario.subarray(consume));
				expect(queue.peek(expected.length)).toEqual(expected);
				expect(queue.available()).toBe(expected.length);
				expect(queue.pull(expected.length)).toEqual(expected);
				expect(queue.available()).toBe(0);

				queue.push(Uint8Array.from(afterReset));
				expect(queue.pull(afterReset.length)).toEqual(
					Uint8Array.from(afterReset),
				);
				expect(queue.available()).toBe(0);
			}
		}));
});
