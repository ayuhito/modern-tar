import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { validateChecksum, writeChecksum } from "../../src/tar/checksum";
import {
	BLOCK_SIZE,
	USTAR_CHECKSUM_OFFSET,
	USTAR_CHECKSUM_SIZE,
} from "../../src/tar/constants";
import { readOctal } from "../../src/tar/encoding";

describe("tar checksum properties", () => {
	it("writes the checksum defined by the TAR header format", () =>
		hegel.test((tc) => {
			const block = Uint8Array.from(
				tc.draw(gs.binary({ minSize: BLOCK_SIZE, maxSize: BLOCK_SIZE })),
			);
			const compactOffset = tc.draw(
				gs.integers({
					minValue: 0,
					maxValue: BLOCK_SIZE - USTAR_CHECKSUM_SIZE - 1,
				}),
			);
			const changedOffset =
				compactOffset < USTAR_CHECKSUM_OFFSET
					? compactOffset
					: compactOffset + USTAR_CHECKSUM_SIZE;

			writeChecksum(block);

			// This is the format definition, independent of the implementation under test:
			// checksum bytes contribute eight ASCII spaces to the unsigned byte sum.
			let expected = USTAR_CHECKSUM_SIZE * 0x20;
			for (let index = 0; index < block.length; index++) {
				if (
					index < USTAR_CHECKSUM_OFFSET ||
					index >= USTAR_CHECKSUM_OFFSET + USTAR_CHECKSUM_SIZE
				)
					expected += block[index];
			}

			expect(readOctal(block, USTAR_CHECKSUM_OFFSET, USTAR_CHECKSUM_SIZE)).toBe(
				expected,
			);
			expect(validateChecksum(block)).toBe(true);

			// Any one-byte change outside the checksum field must invalidate the header.
			block[changedOffset] ^= 1;
			expect(validateChecksum(block)).toBe(false);
		}));
});
