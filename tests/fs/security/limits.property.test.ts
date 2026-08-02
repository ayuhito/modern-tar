import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect } from "vitest";
import { unpackTar } from "../../../src/fs";
import { packTar } from "../../../src/web";
import { it } from "../../helpers/test";

const scenario = gs.record({
	depth: gs.integers({ minValue: 1, maxValue: 40 }),
	delta: gs.sampledFrom([-1, 0, 1]),
});

describe("resource limit properties", () => {
	it("enforces generated maxDepth boundaries", async ({ tmpDir }) => {
		let iteration = 0;
		await hegel.testAsync(async (tc) => {
			const { delta, depth } = tc.draw(scenario);
			const requiredDepth = depth === 1 ? 0 : depth;
			const maxDepth = Math.max(0, requiredDepth + delta);
			const segments = Array.from(
				{ length: depth },
				(_, index) => `level-${index}`,
			);
			segments[segments.length - 1] = "file.txt";
			const name = segments.join("/");
			const extractDir = path.join(tmpDir, String(iteration++));
			const archive = await packTar([
				{
					header: { name, size: 4, type: "file" },
					body: "test",
				},
			]);
			const extraction = pipeline(
				Readable.from([archive]),
				unpackTar(extractDir, { maxDepth }),
			);

			// Single-component paths need no directory depth; nested paths count every
			// component. delta retains the exact boundary in a shrunk counterexample.
			if (requiredDepth <= maxDepth) {
				await expect(extraction).resolves.toBeUndefined();
				expect(await fs.readFile(path.join(extractDir, name), "utf8")).toBe(
					"test",
				);
			} else {
				await expect(extraction).rejects.toThrow(
					"Tar exceeds max specified depth",
				);
				await expect(
					fs.access(path.join(extractDir, segments[0])),
				).rejects.toThrow();
			}
		});
	});
});
