import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packTar } from "../../src/web/helpers";
import { chunkBytes } from "../helpers/bytes";

type Dataset = { count: number; size: number };

const entryName = (index: number) =>
	`nested/${String(Math.floor(index / 1000)).padStart(4, "0")}/file-${String(index).padStart(6, "0")}.bin`;
const entryByte = (index: number) => Math.min(index + 1, 255);
const createEntries = ({ count, size }: Dataset) =>
	Array.from({ length: count }, (_, index) => ({
		header: { name: entryName(index), size, type: "file" as const },
		body: new Uint8Array(size).fill(entryByte(index)),
	}));
const expectedStats = ({ count, size }: Dataset) => ({
	count,
	totalBytes: count * size,
	bodyByteTotal: Array.from(
		{ length: count },
		(_, index) => entryByte(index) * size,
	).reduce((sum, value) => sum + value, 0),
	firstName: count > 0 ? entryName(0) : null,
	lastName: count > 0 ? entryName(count - 1) : null,
});

const medium = { count: 257, size: 64 };
let worker: Miniflare;
let mediumArchive: Uint8Array;

beforeAll(async () => {
	worker = new Miniflare({
		modules: true,
		scriptPath: resolve(import.meta.dirname, "worker-fixture.js"),
		modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
		compatibilityDate: "2025-08-15",
	});
	mediumArchive = await packTar(createEntries(medium));
});

afterAll(() => worker.dispose());

const postArchive = async (
	archive: Uint8Array,
	mode: "response" | "reader" | "iterator" | "buffered",
	parts: number,
) => {
	const { readable, writable } = new TransformStream<Uint8Array>();
	const response = worker.dispatchFetch(`http://localhost:8787/?mode=${mode}`, {
		method: "POST",
		body: readable,
		duplex: "half",
	});
	const writer = writable.getWriter();
	for (const chunk of chunkBytes(archive, Math.ceil(archive.length / parts))) {
		await writer.write(chunk);
	}
	await writer.close();
	return response;
};

describe.sequential("Cloudflare Workers", () => {
	it.each(["response", "reader", "iterator", "buffered"] as const)(
		"decodes fragmented uploads using the %s body API",
		async (mode) => {
			const response = await postArchive(mediumArchive, mode, 64);
			expect(await response.json()).toEqual(expectedStats(medium));
		},
	);

	it("streams one large entry", async () => {
		const dataset = { count: 1, size: 64 * 1024 };
		const archive = await packTar(createEntries(dataset));
		const response = await postArchive(archive, "response", 3);
		expect(await response.json()).toEqual(expectedStats(dataset));
	}, 20_000);

	it("decodes many tiny fragmented entries", async () => {
		const dataset = { count: 8_192, size: 1 };
		const archive = await packTar(createEntries(dataset));
		const response = await postArchive(archive, "response", 512);
		expect(await response.json()).toEqual(expectedStats(dataset));
	}, 30_000);
});
