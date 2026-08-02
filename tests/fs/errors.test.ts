import * as path from "node:path";
import { Readable } from "node:stream";
import { arrayBuffer } from "node:stream/consumers";
import { describe, expect } from "vitest";
import { packTar, type TarSource } from "../../src/fs";
import { it } from "../helpers/test";

describe("filesystem errors", () => {
	it("rejects a missing file source", async ({ tmpDir }) => {
		const stream = packTar([
			{
				type: "file",
				source: path.join(tmpDir, "missing.txt"),
				target: "missing.txt",
			},
		]);

		await expect(arrayBuffer(stream)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it.each([123, true, { invalid: "object" }])(
		"rejects unsupported content %#",
		async (content) => {
			const source = {
				type: "content",
				content,
				target: "invalid.txt",
			} as unknown as TarSource;

			await expect(arrayBuffer(packTar([source]))).rejects.toThrow(
				"Unsupported content type",
			);
		},
	);

	it("rejects a stream shorter than its declared size", async () => {
		const stream = packTar([
			{
				type: "stream",
				content: Readable.from(["short"]),
				target: "short.txt",
				size: 100,
			},
		]);

		await expect(arrayBuffer(stream)).rejects.toThrow("Size mismatch");
	});

	it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
		"rejects invalid stream size %p",
		async (size) => {
			const source = {
				type: "stream",
				content: Readable.from(["content"]),
				target: "invalid.txt",
				size,
			} as unknown as TarSource;

			await expect(arrayBuffer(packTar([source]))).rejects.toThrow(
				"Invalid tar entry size",
			);
		},
	);

	it("requires a positive stream size", async () => {
		const stream = packTar([
			{
				type: "stream",
				content: Readable.from(["content"]),
				target: "empty.txt",
				size: 0,
			},
		]);

		await expect(arrayBuffer(stream)).rejects.toThrow(
			"Streams require a positive size",
		);
	});
});
