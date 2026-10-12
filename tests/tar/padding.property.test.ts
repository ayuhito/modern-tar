import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { BLOCK_SIZE } from "../../src/tar/constants";
import { createUnpacker } from "../../src/tar/unpacker";
import { packTar } from "../../src/web";

describe("tar padding properties", () => {
	it("accepts only zero bytes in strict trailers before source closure", () =>
		hegel.test((tc) => {
			const offset = tc.draw(gs.integers({ minValue: 0, maxValue: 15 }));
			const length = tc.draw(gs.integers({ minValue: 0, maxValue: 2048 }));
			const trailer = new Uint8Array(new ArrayBuffer(offset + length), offset);
			const unpacker = createUnpacker({ strict: true });
			unpacker.write(new Uint8Array(BLOCK_SIZE * 2));
			unpacker.readHeader();

			expect(() => unpacker.write(trailer)).not.toThrow();
			expect(unpacker.available()).toBe(0);
			if (length > 0) {
				const index = tc.draw(
					gs.integers({ minValue: 0, maxValue: length - 1 }),
				);
				trailer[index] = tc.draw(gs.integers({ minValue: 1, maxValue: 255 }));
				expect(() => unpacker.write(trailer)).toThrow("Invalid EOF");
			}
		}));

	it("pads generated bodies and terminates archives on block boundaries", () =>
		hegel.testAsync(async (tc) => {
			const body = Uint8Array.from(tc.draw(gs.binary({ maxSize: 2048 })));
			const padding = -body.length & (BLOCK_SIZE - 1);
			const archive = await packTar([
				{ header: { name: "body.bin", size: body.length }, body },
			]);

			// The expected layout comes directly from the TAR block model:
			// header, body, body padding, and two zero EOF blocks.
			expect(archive).toHaveLength(
				BLOCK_SIZE + body.length + padding + BLOCK_SIZE * 2,
			);
			expect(archive.subarray(BLOCK_SIZE, BLOCK_SIZE + body.length)).toEqual(
				body,
			);
			expect(
				archive.subarray(BLOCK_SIZE + body.length).every((byte) => byte === 0),
			).toBe(true);
		}));
});
