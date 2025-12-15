import { describe, expect, it } from "vitest";
import {
	createGzipDecoder,
	createGzipEncoder,
	createTarDecoder,
	packTar,
	type TarEntry,
	unpackTar,
} from "../../src/web";

const TSGO_WASM_URL = new URL(
	"../web/fixtures/tsgo-wasm-2025.12.7.tgz",
	import.meta.url,
).href;

describe("unpack tar", () => {
	it("handles gzip response body with strip + filter", async () => {
		const entries = [
			{
				header: { name: "pkg/readme.txt", size: 4, type: "file" },
				body: "docs",
			},
			{
				header: { name: "pkg/tsgo.wasm", size: 6, type: "file" },
				body: "wasm!!",
			},
		] as TarEntry[];

		const tarBuffer = await packTar(entries);

		// Compress the tar buffer
		const compressedChunks: Uint8Array[] = [];
		const encoder = createGzipEncoder();
		const writer = encoder.writable.getWriter();
		const reader = encoder.readable.getReader();

		// Start reading compressed chunks
		const readPromise = (async () => {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value) compressedChunks.push(value);
			}
		})();

		// Write and close
		await writer.write(tarBuffer);
		await writer.close();
		await readPromise;

		// Create a stream from the compressed chunks
		const compressed = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of compressedChunks) {
					controller.enqueue(chunk);
				}
				controller.close();
			},
		});

		const decompressed = compressed.pipeThrough(createGzipDecoder());
		const [wasm] = await unpackTar(decompressed, {
			strip: 1,
			filter: (header) => header.name === "tsgo.wasm",
		});

		expect(wasm).toBeDefined();
		expect(wasm.header.name).toBe("tsgo.wasm");
		expect(new TextDecoder().decode(wasm.data)).toBe("wasm!!");
	});

	it("does not hang when entries arrive in delayed chunks", async () => {
		const tarBuffer = await packTar([
			{
				header: { name: "first.txt", size: 5, type: "file" },
				body: "hello",
			},
			{
				header: { name: "second.txt", size: 5, type: "file" },
				body: "world",
			},
		]);

		const firstChunk = tarBuffer.subarray(0, 800);
		const remainder = tarBuffer.subarray(800);

		const delayedStream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(firstChunk);
				setTimeout(() => {
					controller.enqueue(remainder);
					controller.close();
				}, 10);
			},
		});

		const entryStream = delayedStream.pipeThrough(createTarDecoder());
		const names: string[] = [];

		for await (const entry of entryStream) {
			names.push(entry.header.name);
			// Cancel the body to ensure the decoder can advance to the next entry.
			await entry.body.cancel();
		}

		expect(names).toEqual(["first.txt", "second.txt"]);
	});

	it(
		"streams real tarball and extracts wasm via filter",
		{ timeout: 60_000 },
		async () => {
			const response = await fetch(TSGO_WASM_URL);
			if (!response.body) throw new Error("No response body");

			const tarStream = response.body.pipeThrough(createGzipDecoder());
			const entryStream = tarStream.pipeThrough(createTarDecoder());
			const reader = entryStream.getReader();

			let sawWasm = false;
			let wasmLength = 0;
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const name = value.header.name.split("/").slice(1).join("/");
					if (name !== "tsgo.wasm") {
						const skipReader = value.body.getReader();
						while (true) {
							const { done: skipDone } = await skipReader.read();
							if (skipDone) break;
						}
						skipReader.releaseLock();
						continue;
					}

					// Read the entire body to ensure the stream completes without hanging.
					const bodyReader = value.body.getReader();
					let total = 0;
					while (true) {
						const { done: bodyDone, value: chunk } = await bodyReader.read();
						if (bodyDone) break;
						total += chunk?.length ?? 0;
					}
					wasmLength = total;
					expect(wasmLength).toBeGreaterThan(0);
					sawWasm = true;
					bodyReader.releaseLock();
					// Continue to drain the rest of the entries to ensure full completion.
				}
			} finally {
				reader.releaseLock();
			}

			expect(sawWasm).toBe(true);
			expect(wasmLength).toBeGreaterThan(0);
		},
	);

	it(
		"unpackTar resolves when filtering a streamed gzip tarball",
		{ timeout: 60_000 },
		async () => {
			const response = await fetch(TSGO_WASM_URL);
			if (!response.body) throw new Error("No response body");

			const tarStream = response.body.pipeThrough(createGzipDecoder());

			const { entries, durationMs } = await Promise.race([
				(async () => {
					const start = performance.now();
					const results = await unpackTar(tarStream, {
						strip: 1,
						filter: (header) => header.name === "tsgo.wasm",
					});
					return {
						entries: results,
						durationMs: performance.now() - start,
					};
				})(),
				new Promise<never>((_, reject) =>
					setTimeout(
						() =>
							reject(
								new Error(
									"unpackTar did not resolve within the expected timeframe",
								),
							),
						10_000,
					),
				),
			]);

			expect(entries).toHaveLength(1);
			const [wasm] = entries;
			expect(wasm).toBeDefined();
			expect(wasm.header.name).toBe("tsgo.wasm");
			expect(wasm.data?.length).toBeGreaterThan(0);
			expect(durationMs).toBeLessThan(10_000);
		},
	);
});
