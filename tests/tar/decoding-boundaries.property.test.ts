import { readFile } from "node:fs/promises";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { decoder } from "../../src/tar/encoding";
import { unpackTar } from "../../src/web";
import { chunkBytes } from "../helpers/bytes";
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
	it("decodes fixed compatibility manifests across generated fragment sizes", () =>
		hegel.testAsync(async (tc) => {
			const fixture = tc.draw(gs.sampledFrom(fixtures));
			const width = tc.draw(gs.integers({ minValue: 1, maxValue: 1024 }));
			const archive = await readFile(fixture.path);
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					for (const chunk of chunkBytes(archive, width))
						controller.enqueue(chunk);
					controller.close();
				},
			});

			const entries = await unpackTar(stream, { strict: true });
			expect(
				entries.map(({ header, data }) => [header.name, decoder.decode(data)]),
			).toEqual(fixture.entries);
		}));
});
