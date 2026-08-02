import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { createChunkQueue } from "../../src/tar/chunk-queue";

describe("chunk queue properties", () => {
	it("preserves bytes while wrapping, growing, and resetting", () =>
		hegel.test((tc) => {
			const consumed = tc.draw(gs.integers({ minValue: 1, maxValue: 199 }));
			const bytes = tc.draw(
				gs.binary({ minSize: 256 + consumed, maxSize: 256 + consumed }),
			);
			const afterReset = tc.draw(gs.binary({ minSize: 1, maxSize: 64 }));

			for (const consume of [0, consumed]) {
				const queue = createChunkQueue();
				const scenario = bytes.subarray(0, 256 + consume);

				for (const byte of scenario.subarray(0, 200)) {
					queue.push(Uint8Array.of(byte));
				}
				expect(queue.pull(consume)).toEqual(
					Uint8Array.from(scenario.subarray(0, consume)),
				);

				for (const byte of scenario.subarray(200)) {
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
