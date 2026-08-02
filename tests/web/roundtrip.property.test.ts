import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { packTar, unpackTar } from "../../src/web";
import { chunkBytes } from "../helpers/bytes";

const segment = gs.text({
	alphabet:
		"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_éñ测试файл",
	minSize: 1,
	maxSize: 120,
});

const entry = gs.record({
	data: gs.optional(gs.binary({ maxSize: 1024 })),
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
		hegel.testAsync(async (tc) => {
			const generated = tc.draw(gs.arrays(entry, { minSize: 1, maxSize: 4 }));
			const fragmentSize = tc.draw(
				gs.integers({ minValue: 1, maxValue: 1024 }),
			);
			const sources = generated.map((value, index) => {
				const directory = value.data === null;
				const name = `${index}-${value.name}${directory ? "/" : ""}`;
				const header = {
					name,
					type: directory ? ("directory" as const) : ("file" as const),
					size: value.data?.length ?? 0,
					mode: value.mode,
					uid: value.uid,
					gid: value.gid,
					mtime: new Date(value.mtimeSeconds * 1000),
				};

				return value.data === null ? { header } : { header, body: value.data };
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
					name: `${index}-${expected.name}${expected.data === null ? "/" : ""}`,
					type: expected.data === null ? "directory" : "file",
					size: expected.data?.length ?? 0,
					mode: expected.mode,
					uid: expected.uid,
					gid: expected.gid,
					mtime: new Date(expected.mtimeSeconds * 1000),
				});
				if (expected.data === null) {
					expect(actual.data).toBeUndefined();
				} else {
					expect(actual.data).toEqual(Uint8Array.from(expected.data));
				}
			}
		}));
});
