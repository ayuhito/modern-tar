import { describe, expect, it } from "vitest";
import { BLOCK_SIZE, USTAR_CHECKSUM_OFFSET } from "../../src/tar/constants";
import { packTar, unpackTar } from "../../src/web";

describe("tar checksum validation", () => {
	it("rejects corruption after an earlier valid entry", async () => {
		const archive = await packTar([
			{ header: { name: "first.txt", size: 5 }, body: "first" },
			{ header: { name: "second.txt", size: 6 }, body: "second" },
		]);
		const secondHeader = BLOCK_SIZE * 2;
		archive[secondHeader + USTAR_CHECKSUM_OFFSET] ^= 1;

		await expect(unpackTar(archive, { strict: true })).rejects.toThrow(
			"Invalid tar header checksum",
		);
	});
});
