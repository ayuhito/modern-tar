import { beforeAll, describe, expect, it } from "vitest";
import { createTarDecoder, packTar, unpackTar } from "../../src/web";
import { chunkBytes } from "../helpers/bytes";

let archive: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
	archive = await packTar([
		{ header: { name: "pkg/readme.txt", size: 4 }, body: "docs" },
		{ header: { name: "pkg/module.wasm", size: 6 }, body: "wasm!!" },
	]);
});

const fragmentedArchive = (crossTaskBoundary = false) => {
	const chunks = chunkBytes(archive, 127)[Symbol.iterator]();
	let delivered = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			// Split the first header across browser tasks without a wall-clock assertion.
			if (crossTaskBoundary && delivered === 1)
				await new Promise((resolve) => setTimeout(resolve, 0));
			const { done, value } = chunks.next();
			if (done) controller.close();
			else {
				delivered++;
				controller.enqueue(value);
			}
		},
	});
};

describe("browser runtime", () => {
	it("buffers complete ArrayBuffer archives", async () => {
		const entries = await unpackTar(archive.buffer);
		expect(entries.map(({ header }) => header.name)).toEqual([
			"pkg/readme.txt",
			"pkg/module.wasm",
		]);
	});

	it("uses native compression and decompression streams", async () => {
		const compressed = new Response(archive).body?.pipeThrough(
			new CompressionStream("gzip"),
		);
		if (!compressed) throw new Error("Expected response body");
		const [wasm] = await unpackTar(
			compressed.pipeThrough(new DecompressionStream("gzip")),
			{
				strip: 1,
				filter: (header) => header.name === "module.wasm",
			},
		);

		expect(new TextDecoder().decode(wasm.data)).toBe("wasm!!");
	});

	it("advances after bodies are consumed or cancelled", async () => {
		const reader = fragmentedArchive(true)
			.pipeThrough(createTarDecoder({ strict: true }))
			.getReader();
		const first = await reader.read();
		if (!first.value) throw new Error("Expected first entry");
		expect(await new Response(first.value.body).text()).toBe("docs");

		const second = await reader.read();
		if (!second.value) throw new Error("Expected second entry");
		expect(second.value.header.name).toBe("pkg/module.wasm");
		await second.value.body.cancel();
		await expect(reader.read()).resolves.toMatchObject({ done: true });
	});

	it("filters fragmented archive streams", async () => {
		const [wasm] = await unpackTar(fragmentedArchive(), {
			strip: 1,
			filter: (header) => header.name === "module.wasm",
		});

		expect(wasm.header.name).toBe("module.wasm");
		expect(new TextDecoder().decode(wasm.data)).toBe("wasm!!");
	});
});
