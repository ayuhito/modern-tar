import { describe, expect, it } from "vitest";
import { decoder } from "../../src/tar/encoding";
import { transformHeader } from "../../src/tar/options";
import { packTar, unpackTar } from "../../src/web";

describe("unpack options", () => {
	it.each([
		["a//b/file.txt", "b/file.txt"],
		["/a/b/file.txt", "b/file.txt"],
	] as const)(
		"normalizes empty path components while stripping %s",
		(name, expected) => {
			expect(transformHeader({ name, size: 0 }, { strip: 1 })?.name).toBe(
				expected,
			);
		},
	);

	it("preserves directory markers after stripping", () => {
		expect(
			transformHeader(
				{ name: "root/path/to/directory", size: 0, type: "directory" },
				{ strip: 1 },
			)?.name,
		).toBe("path/to/directory/");
	});

	it("applies strip, filter, and map in that order", () => {
		const calls: string[] = [];
		const result = transformHeader(
			{ name: "root/file.txt", size: 0, mode: 0o600 },
			{
				strip: 1,
				filter(header) {
					calls.push(`filter:${header.name}`);
					return header.name.endsWith(".txt");
				},
				map(header) {
					calls.push(`map:${header.name}`);
					return { ...header, name: `mapped/${header.name}`, mode: 0o644 };
				},
			},
		);

		expect(calls).toEqual(["filter:file.txt", "map:file.txt"]);
		expect(result).toMatchObject({ name: "mapped/file.txt", mode: 0o644 });
	});

	it.each(["", "   ", ".", "/"])("rejects mapped root name %j", (name) => {
		expect(
			transformHeader(
				{ name: "file.txt", size: 0 },
				{ map: (header) => ({ ...header, name }) },
			),
		).toBeNull();
	});

	it("filters and maps buffered entries without changing file data", async () => {
		const archive = await packTar([
			{ header: { name: "root/keep.txt", size: 4 }, body: "keep" },
			{ header: { name: "root/drop.js", size: 4 }, body: "drop" },
		]);
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(archive);
				controller.close();
			},
		});
		const entries = await unpackTar(stream, {
			strip: 1,
			filter: (header) => header.name.endsWith(".txt"),
			map: (header) => ({ ...header, name: `mapped/${header.name}` }),
		});

		expect(entries).toHaveLength(1);
		expect(entries[0].header.name).toBe("mapped/keep.txt");
		expect(decoder.decode(entries[0].data)).toBe("keep");
	});

	it.each(["filter", "map"] as const)(
		"propagates %s callback errors",
		async (callback) => {
			const reason = new Error(`${callback} failed`);
			const fail = (): never => {
				throw reason;
			};
			const archive = await packTar([
				{ header: { name: "file.txt", size: 1 }, body: "x" },
			]);
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(archive);
					controller.close();
				},
			});
			const options = callback === "filter" ? { filter: fail } : { map: fail };

			await expect(unpackTar(stream, options)).rejects.toBe(reason);
		},
	);
});
