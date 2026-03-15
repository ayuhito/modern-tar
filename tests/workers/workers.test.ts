import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import { packTar } from "../../src/web/helpers";

const __dirname = resolve(fileURLToPath(new URL(".", import.meta.url)));
const fixturePath = (name: string) => resolve(__dirname, name);

type DatasetOptions = {
	count: number;
	size: number;
};

type WritePlan = {
	initialBytes?: number;
	initialDelayMs?: number;
	parts?: number;
};

// Generates a dataset of tar entries with predictable names and body content based on the index.
function entryName(index: number) {
	return `nested/${String(Math.floor(index / 1000)).padStart(4, "0")}/file-${String(index).padStart(6, "0")}.bin`;
}

function entryByte(index: number) {
	return Math.min(index + 1, 255);
}

function entryBody(index: number, size: number) {
	return new Uint8Array(size).fill(entryByte(index));
}

function createEntries(options: DatasetOptions) {
	return Array.from({ length: options.count }, (_, index) => {
		return {
			header: {
				name: entryName(index),
				size: options.size,
				type: "file" as const,
			},
			body: entryBody(index, options.size),
		};
	});
}

// Calculates expected statistics about the decoded tar entries based on the input dataset options.
function expectedDecodeStats(options: DatasetOptions) {
	const totalBytes = options.count * options.size;
	let bodyByteTotal = 0;

	for (let index = 0; index < options.count; index++) {
		bodyByteTotal += entryByte(index) * options.size;
	}

	return {
		count: options.count,
		totalBytes,
		bodyByteTotal,
		firstName: options.count > 0 ? entryName(0) : null,
		lastName: options.count > 0 ? entryName(options.count - 1) : null,
	};
}

async function withWorker<T>(
	fixture: string,
	run: (mf: Miniflare) => Promise<T>,
) {
	const mf = new Miniflare({
		modules: true,
		scriptPath: fixturePath(fixture),
		modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
		compatibilityDate: "2025-08-15",
	});
	try {
		return await run(mf);
	} finally {
		await mf.dispose();
	}
}

async function writeArchive(
	writer: WritableStreamDefaultWriter<Uint8Array>,
	tarBuffer: Uint8Array,
	plan: WritePlan = {},
) {
	const initialBytes = Math.min(
		plan.initialBytes ?? tarBuffer.length,
		tarBuffer.length,
	);
	if (initialBytes > 0) {
		await writer.write(tarBuffer.subarray(0, initialBytes));
	}

	if ((plan.initialDelayMs ?? 0) > 0) {
		await new Promise((resolve) => setTimeout(resolve, plan.initialDelayMs));
	}

	const parts = Math.max(1, plan.parts ?? 1);
	const remaining = tarBuffer.length - initialBytes;

	// If there are remaining bytes after the initial chunk, write them in parts with optional delays.
	if (remaining > 0) {
		const chunkSize = Math.max(1, Math.ceil(remaining / parts));
		for (
			let offset = initialBytes;
			offset < tarBuffer.length;
			offset += chunkSize
		) {
			await writer.write(
				tarBuffer.subarray(
					offset,
					Math.min(tarBuffer.length, offset + chunkSize),
				),
			);
		}
	}

	await writer.close();
}

async function postArchive(
	mf: Miniflare,
	tarBuffer: Uint8Array,
	writePlan: WritePlan = {},
) {
	const { readable, writable } = new TransformStream<Uint8Array>();
	const writer = writable.getWriter();
	const responsePromise = mf.dispatchFetch("http://localhost:8787/", {
		method: "POST",
		body: readable,
		duplex: "half",
	});

	await writeArchive(writer, tarBuffer, writePlan);
	return await responsePromise;
}

describe.sequential("Cloudflare Workers", () => {
	it("streams a single large entry through Response.arrayBuffer()", async () => {
		const options = { count: 1, size: 64 * 1024 };
		const tarBuffer = await packTar(createEntries(options));

		await withWorker("worker-arraybuffer-fixture.js", async (mf) => {
			const response = await postArchive(mf, tarBuffer, {
				initialBytes: 512,
				initialDelayMs: 200,
				parts: 2,
			});
			const decodeStats = await response.json();

			expect(decodeStats).toEqual(expectedDecodeStats(options));
		});
	}, 20_000);

	it("handles a heavily fragmented upload with many tiny entries", async () => {
		const options = { count: 8_192, size: 1 };
		const tarBuffer = await packTar(createEntries(options));

		await withWorker("worker-arraybuffer-fixture.js", async (mf) => {
			const response = await postArchive(mf, tarBuffer, {
				initialBytes: 512,
				initialDelayMs: 200,
				parts: 512,
			});
			const decodeStats = await response.json();

			expect(decodeStats).toEqual(expectedDecodeStats(options));
		});
	}, 30_000);

	it("handles fragmented uploads with many medium entries via Response.arrayBuffer()", async () => {
		const options = { count: 257, size: 64 };
		const tarBuffer = await packTar(createEntries(options));

		await withWorker("worker-arraybuffer-fixture.js", async (mf) => {
			const response = await postArchive(mf, tarBuffer, {
				initialBytes: 1024,
				initialDelayMs: 50,
				parts: 64,
			});
			const decodeStats = await response.json();

			expect(decodeStats).toEqual(expectedDecodeStats(options));
		});
	}, 20_000);

	it("handles fragmented uploads with manual readers in a worker", async () => {
		const options = { count: 257, size: 64 };
		const tarBuffer = await packTar(createEntries(options));

		await withWorker("worker-reader-fixture.js", async (mf) => {
			const response = await postArchive(mf, tarBuffer, {
				initialBytes: 1024,
				initialDelayMs: 50,
				parts: 64,
			});
			const decodeStats = await response.json();

			expect(decodeStats).toEqual(expectedDecodeStats(options));
		});
	}, 20_000);

	it("handles fragmented uploads with async iterators in a worker", async () => {
		const options = { count: 257, size: 64 };
		const tarBuffer = await packTar(createEntries(options));

		await withWorker("worker-iterator-fixture.js", async (mf) => {
			const response = await postArchive(mf, tarBuffer, {
				initialBytes: 1024,
				initialDelayMs: 50,
				parts: 64,
			});
			const decodeStats = await response.json();

			expect(decodeStats).toEqual(expectedDecodeStats(options));
		});
	}, 20_000);

	it("handles fragmented uploads with unpackTar() in a worker", async () => {
		const options = { count: 257, size: 64 };
		const tarBuffer = await packTar(createEntries(options));

		await withWorker("worker-unpack-fixture.js", async (mf) => {
			const response = await postArchive(mf, tarBuffer, {
				initialBytes: 1024,
				initialDelayMs: 50,
				parts: 64,
			});
			const decodeStats = await response.json();

			expect(decodeStats).toEqual(expectedDecodeStats(options));
		});
	}, 20_000);
});
