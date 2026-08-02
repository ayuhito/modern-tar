import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { streamToBuffer } from "../../src/web/stream-utils";
import { streamFromChunks } from "../helpers/bytes";

describe("web helper properties", () => {
	it("concatenates generated stream chunks without changing their bytes", () =>
		hegel.testAsync(async (tc) => {
			const chunks = tc.draw(
				gs.arrays(gs.binary({ maxSize: 4096 }), { maxSize: 16 }),
			);
			const stream = streamFromChunks(
				chunks.map((chunk) => Uint8Array.from(chunk)),
			);
			const expected = Uint8Array.from(
				chunks.flatMap((chunk) => Array.from(chunk)),
			);

			expect(await streamToBuffer(stream)).toEqual(expected);
		}));
});
