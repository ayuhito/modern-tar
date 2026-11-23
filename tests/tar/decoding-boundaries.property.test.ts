import { readFile } from "node:fs/promises";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { BLOCK_SIZE } from "../../src/tar/constants";
import { decoder } from "../../src/tar/encoding";
import { unpackTar } from "../../src/web";
import { streamFromChunks } from "../helpers/bytes";
import { GNU_TAR, PAX_TAR, UNKNOWN_FORMAT, V7_TAR } from "../web/fixtures";

const fixtures = [
	{ path: V7_TAR, entries: [["test.txt", "Hello, world!\n"]] },
	{ path: GNU_TAR, entries: [["test.txt", "Hello, world!\n"]] },
	{ path: PAX_TAR, entries: [["pax.txt", "hello world\n"]] },
	{
		path: UNKNOWN_FORMAT,
		entries: [
			["file-1.txt", "i am file-1\n"],
			["file-2.txt", "i am file-2\n"],
		],
	},
] as const;

describe("tar decoding boundary properties", () => {
	it("decodes compatibility fixtures split around tar block boundaries", () =>
		hegel.testAsync(async (tc) => {
			const fixture = tc.draw(gs.sampledFrom(fixtures));
			const archive = await readFile(fixture.path);
			const offsets: number[] = [];
			for (let end = BLOCK_SIZE; end < archive.length; end += BLOCK_SIZE) {
				offsets.push(end - 1, end, end + 1);
			}
			const cuts = tc.draw(gs.subsequences(offsets, { minSize: 1 }));
			const chunks = [...cuts, archive.length].map((end, index) =>
				archive.subarray(cuts[index - 1] ?? 0, end),
			);
			const stream = streamFromChunks(chunks);

			const entries = await unpackTar(stream, { strict: true });
			expect(
				entries.map(({ header, data }) => [header.name, decoder.decode(data)]),
			).toEqual(fixture.entries);
		}));
});
