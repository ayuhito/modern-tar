import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { packTar, unpackTar } from "../../src/web";
import { chunkBytes } from "../helpers/bytes";

type GeneratedEntry = {
	data: Uint8Array;
	directory: boolean;
	gid: number;
	mode: number;
	mtimeSeconds: number;
	name: string;
	uid: number;
};

const segment = gs.text({
	alphabet: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_",
	minSize: 1,
	maxSize: 12,
});

const entry = gs.record<GeneratedEntry>({
	data: gs.binary({ maxSize: 1024 }),
	directory: gs.booleans(),
	gid: gs.integers({ minValue: 0, maxValue: 1_000_000 }),
	mode: gs.integers({ minValue: 0, maxValue: 0o777 }),
	mtimeSeconds: gs.integers({ minValue: 0, maxValue: 2 ** 31 - 1 }),
	name: gs
		.arrays(segment, { minSize: 1, maxSize: 3 })
		.map((parts) => parts.join("/")),
	uid: gs.integers({ minValue: 0, maxValue: 1_000_000 }),
});

describe("web archive properties", () => {
	it("round-trips generated entries through fragmented streams", () =>
		hegel.testAsync(
			async (tc) => {
				const generated = tc.draw(gs.arrays(entry, { maxSize: 4 }));
				const fragmentSize = tc.draw(
					gs.integers({ minValue: 1, maxValue: 1024 }),
				);
				const sources = generated.map((value, index) => {
					const name = `${index}-${value.name}${value.directory ? "/" : ""}`;
					const header = {
						name,
						type: value.directory ? ("directory" as const) : ("file" as const),
						size: value.directory ? 0 : value.data.length,
						mode: value.mode,
						uid: value.uid,
						gid: value.gid,
						mtime: new Date(value.mtimeSeconds * 1000),
					};

					return value.directory ? { header } : { header, body: value.data };
				});
				const archive = await packTar(sources);
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						for (const fragment of chunkBytes(archive, fragmentSize)) {
							controller.enqueue(fragment);
						}
						controller.close();
					},
				});

				const unpacked = await unpackTar(stream, { strict: true });

				expect(unpacked).toHaveLength(generated.length);
				for (const [index, actual] of unpacked.entries()) {
					const expected = generated[index];
					expect(actual.header).toMatchObject({
						name: `${index}-${expected.name}${expected.directory ? "/" : ""}`,
						type: expected.directory ? "directory" : "file",
						size: expected.directory ? 0 : expected.data.length,
						mode: expected.mode,
						uid: expected.uid,
						gid: expected.gid,
						mtime: new Date(expected.mtimeSeconds * 1000),
					});
					if (expected.directory) {
						expect(actual.data).toBeUndefined();
					} else {
						expect(actual.data).toEqual(Uint8Array.from(expected.data));
					}
				}
			},
			{ testCases: 50 },
		));
});
