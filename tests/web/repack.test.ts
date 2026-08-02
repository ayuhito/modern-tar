import { describe, expect, it } from "vitest";
import { decoder } from "../../src/tar/encoding";
import { packTar, unpackTar } from "../../src/web";

describe("repacking", () => {
	it("accepts buffered entries through their data field", async () => {
		const original = await packTar([
			{ header: { name: "file.txt", size: 5 }, body: "hello" },
			{ header: { name: "empty.txt", size: 0 }, body: "" },
			{
				header: { name: "directory/", size: 0, type: "directory" },
				body: undefined,
			},
		]);
		const entries = await unpackTar(await packTar(await unpackTar(original)));

		expect(
			entries.map(({ header }) => [header.name, header.type, header.size]),
		).toEqual([
			["file.txt", "file", 5],
			["empty.txt", "file", 0],
			["directory/", "directory", 0],
		]);
		expect(decoder.decode(entries[0].data)).toBe("hello");
		expect(entries[1].data).toEqual(new Uint8Array(0));
		expect(entries[2].data).toBeUndefined();
	});

	it("ignores empty data attached to bodyless entries", async () => {
		const entries = await unpackTar(
			await packTar([
				{
					header: { name: "directory/", size: 0, type: "directory" },
					data: new Uint8Array(0),
				},
				{
					header: {
						name: "symlink",
						size: 0,
						type: "symlink",
						linkname: "target",
					},
					data: new Uint8Array(0),
				},
			]),
		);

		expect(entries.map(({ header }) => header.type)).toEqual([
			"directory",
			"symlink",
		]);
	});
});
