import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { arrayBuffer } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import { describe, expect } from "vitest";
import { packTar, unpackTar } from "../../src/fs";
import { createDeferred } from "../helpers/deferred";
import { it } from "../helpers/test";
import { writeTree } from "../helpers/tree";

describe("filesystem concurrency", () => {
	it("extracts the same archive concurrently", async ({ tmpDir }) => {
		const source = await writeTree(path.join(tmpDir, "source"), {
			"nested/file.txt": "content",
		});
		const archive = new Uint8Array(await arrayBuffer(packTar(source)));

		await Promise.all(
			Array.from({ length: 10 }, async (_, index) => {
				const destination = path.join(tmpDir, `extract-${index}`);
				await pipeline(Readable.from([archive]), unpackTar(destination));
				expect(
					await readFile(path.join(destination, "nested", "file.txt"), "utf8"),
				).toBe("content");
			}),
		);
	});

	it("propagates cancellation while an archive source is paused", async ({
		tmpDir,
	}) => {
		const source = await writeTree(path.join(tmpDir, "source"), {
			"file.txt": "content",
		});
		const archive = new Uint8Array(await arrayBuffer(packTar(source)));
		const firstFragmentRead = createDeferred();
		const resume = createDeferred();
		async function* fragments() {
			yield archive.subarray(0, 512);
			firstFragmentRead.resolve();
			await resume.promise;
			yield archive.subarray(512);
		}

		const output = unpackTar(path.join(tmpDir, "extract"));
		const extraction = pipeline(Readable.from(fragments()), output);
		await firstFragmentRead.promise;

		output.destroy(new Error("cancelled"));
		resume.resolve();

		await expect(extraction).rejects.toThrow("cancelled");
	});

	it("accepts an empty archive pipeline", async ({ tmpDir }) => {
		const source = await writeTree(path.join(tmpDir, "source"), {});
		await pipeline(packTar(source), unpackTar(path.join(tmpDir, "extract")));
	});
});
