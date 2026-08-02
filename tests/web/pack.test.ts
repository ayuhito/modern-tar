import { describe, expect, it } from "vitest";
import { decoder, encoder } from "../../src/tar/encoding";
import { packTar, type TarEntry, unpackTar } from "../../src/web";

const bodyCases: readonly (readonly [string, () => TarEntry["body"]])[] = [
	["string", () => "content"],
	["Uint8Array", () => encoder.encode("content")],
	["ArrayBuffer", () => encoder.encode("content").buffer],
	["Blob", () => new Blob(["content"])],
	[
		"ReadableStream",
		() =>
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode("content"));
					controller.close();
				},
			}),
	],
];

describe("packTar", () => {
	it("preserves a file header and body", async () => {
		const mtime = new Date(1_387_580_181_000);
		const [entry] = await unpackTar(
			await packTar([
				{
					header: {
						name: "test.txt",
						size: 12,
						mode: 0o644,
						uid: 501,
						gid: 20,
						uname: "maf",
						gname: "staff",
						mtime,
					},
					body: "hello world\n",
				},
			]),
		);

		expect(entry.header).toMatchObject({
			name: "test.txt",
			size: 12,
			mode: 0o644,
			uid: 501,
			gid: 20,
			uname: "maf",
			gname: "staff",
			mtime,
		});
		expect(decoder.decode(entry.data)).toBe("hello world\n");
	});

	it("preserves bodyless and special entry types", async () => {
		const headers = [
			{ name: "directory/", size: 0, type: "directory" as const },
			{
				name: "symlink",
				size: 0,
				type: "symlink" as const,
				linkname: "target",
			},
			{ name: "hardlink", size: 0, type: "link" as const, linkname: "target" },
			{ name: "character", size: 0, type: "character-device" as const },
			{ name: "block", size: 0, type: "block-device" as const },
			{ name: "fifo", size: 0, type: "fifo" as const },
		];
		const entries = await unpackTar(
			await packTar(headers.map((header) => ({ header }))),
		);

		expect(entries.map(({ header }) => header.type)).toEqual(
			headers.map(({ type }) => type),
		);
		expect(entries.every((entry) => entry.header.size === 0)).toBe(true);
		expect(entries.every((entry) => entry.data === undefined)).toBe(true);
	});

	it.each(bodyCases)("accepts %s bodies", async (_name, createBody) => {
		const body = createBody();
		const [entry] = await unpackTar(
			await packTar([
				{
					header: { name: "body.txt", size: 7 },
					body,
				} as TarEntry,
			]),
		);

		expect(decoder.decode(entry.data)).toBe("content");
	});

	it.each([null, undefined])(
		"accepts an absent body %s for empty files",
		async (body) => {
			const [entry] = await unpackTar(
				await packTar([{ header: { name: "empty", size: 0 }, body }]),
			);
			expect(entry.data).toEqual(new Uint8Array(0));
		},
	);

	it.each([
		["boolean", true],
		["object", {}],
		["number", 123],
		["symbol", Symbol("body")],
		["function", () => {}],
		["date", new Date(0)],
	] as const)("rejects %s bodies", async (_name, body) => {
		await expect(
			packTar([
				{
					header: { name: "invalid", size: 0 },
					// biome-ignore lint/suspicious/noExplicitAny: Runtime validation contract.
					body: body as any,
				},
			]),
		).rejects.toThrow('Unsupported content type for entry "invalid"');
	});

	it("propagates body stream errors", async () => {
		const reason = new Error("body failed");
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(reason);
			},
		});

		await expect(
			packTar([{ header: { name: "stream", size: 1 }, body }]),
		).rejects.toBe(reason);
	});
});
