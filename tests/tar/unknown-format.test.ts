import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { decoder } from "../../src/tar/encoding";
import { unpackTar } from "../../src/web";
import { UNKNOWN_FORMAT } from "../web/fixtures";

describe("pre-USTAR compatibility", () => {
	it.each([false, true])(
		"reads an archive without a recognized magic field with strict=%s",
		async (strict) => {
			const entries = await unpackTar(await readFile(UNKNOWN_FORMAT), {
				strict,
			});

			expect(
				entries.map(({ header, data }) => ({
					name: header.name,
					type: header.type,
					uname: header.uname,
					gname: header.gname,
					body: decoder.decode(data),
				})),
			).toEqual([
				{
					name: "file-1.txt",
					type: "file",
					uname: undefined,
					gname: undefined,
					body: "i am file-1\n",
				},
				{
					name: "file-2.txt",
					type: "file",
					uname: undefined,
					gname: undefined,
					body: "i am file-2\n",
				},
			]);
		},
	);
});
