import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect } from "vitest";
import { packTar, unpackTar } from "../../src/fs";
import { it } from "../helpers/test";
import { writeTree } from "../helpers/tree";

const segment = gs.text({
	alphabet: "abcdefghijklmnopqrstuvwxyz0123456789-_éñ测试файл",
	minSize: 1,
	maxSize: 24,
});

const file = gs.record({
	body: gs.binary({ maxSize: 4096 }),
	segments: gs.arrays(segment, { minSize: 1, maxSize: 4 }),
});

async function listFiles(root: string, prefix = ""): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(path.join(root, prefix), {
		withFileTypes: true,
	})) {
		const name = path.join(prefix, entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(root, name)));
		else files.push(name.split(path.sep).join("/"));
	}
	return files.sort();
}

describe("filesystem archive properties", () => {
	it("round-trips generated temporary trees", async ({ tmpDir }) => {
		let iteration = 0;
		await hegel.testAsync(async (tc) => {
			const generated = tc.draw(gs.arrays(file, { minSize: 1, maxSize: 6 }));
			const files = Object.fromEntries(
				generated.map(({ body, segments }, index) => [
					`${index}-${segments.join("/")}`,
					Uint8Array.from(body),
				]),
			);
			const root = path.join(tmpDir, String(iteration++));
			const source = await writeTree(path.join(root, "source"), files);
			const destination = path.join(root, "destination");

			await pipeline(packTar(source), unpackTar(destination));

			// The filesystem manifest is the model: every generated path must exist,
			// no extra path may appear, and every byte must be preserved.
			expect(await listFiles(destination)).toEqual(Object.keys(files).sort());
			for (const [name, body] of Object.entries(files)) {
				expect(
					Uint8Array.from(await readFile(path.join(destination, name))),
				).toEqual(body);
			}
		});
	});
});
