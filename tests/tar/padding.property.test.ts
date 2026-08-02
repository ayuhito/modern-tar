import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { BLOCK_SIZE } from "../../src/tar/constants";
import { packTar } from "../../src/web";

describe("tar padding properties", () => {
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
