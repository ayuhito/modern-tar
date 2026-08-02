import { describe, expect, it } from "vitest";
import { normalizeBody } from "../../src/tar/body";
import { decoder } from "../../src/tar/encoding";

describe("tar body normalization", () => {
	it.each(["hello", "", "café"])("encodes string bodies %j", async (body) => {
		expect(decoder.decode(await normalizeBody(body))).toBe(body);
	});

	it("returns Uint8Array bodies unchanged", async () => {
		const body = Uint8Array.of(1, 2, 3);
		expect(await normalizeBody(body)).toBe(body);
	});

	it("normalizes an absent body to empty bytes", async () => {
		expect(await normalizeBody(undefined)).toEqual(new Uint8Array(0));
	});
});
