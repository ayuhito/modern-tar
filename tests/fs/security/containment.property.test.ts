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

const segment = gs.text({
	alphabet: "abcdefghijklmnopqrstuvwxyz0123456789-_éñ测试файл",
	minSize: 1,
	maxSize: 16,
});

const scenario = gs.record({
	escapes: gs.sampledFrom([false, true]),
	prefix: gs.arrays(segment, { maxSize: 5 }),
	separator: gs.sampledFrom(["/", "//", "\\"]),
});

describe("path containment properties", () => {
	it("keeps generated paths inside the extraction root", async ({ tmpDir }) => {
		let iteration = 0;
		await hegel.testAsync(async (tc) => {
			const { escapes, prefix, separator } = tc.draw(scenario);
			const safePrefix = prefix.map((value, index) => `part-${index}-${value}`);
			const root = path.join(tmpDir, String(iteration++));
			const extractDir = path.join(root, "extract");
			const outsideDir = path.join(root, "outside");
			await Promise.all([
				fs.mkdir(extractDir, { recursive: true }),
				fs.mkdir(outsideDir, { recursive: true }),
			]);

			// An escaping case walks back through every generated safe prefix and one
			// level beyond the extraction root, so its target is always root/outside.
			const parts = escapes
				? [
						...safePrefix,
						...Array.from({ length: safePrefix.length + 1 }, () => ".."),
						"outside",
						"escaped.txt",
					]
				: [...safePrefix, "inside.txt"];
			const name = parts.join(separator);
			const archive = await packTar([
				{
					header: { name, size: 4, type: "file" },
					body: "safe",
				},
			]);
			const extraction = pipeline(
				Readable.from([archive]),
				unpackTar(extractDir),
			);

			if (escapes) {
				await expect(extraction).rejects.toThrow(
					/points outside.*extraction directory/,
				);
				await expect(
					fs.access(path.join(outsideDir, "escaped.txt")),
				).rejects.toThrow();
			} else {
				await expect(extraction).resolves.toBeUndefined();
				expect(
					await fs.readFile(path.join(extractDir, ...safePrefix, "inside.txt")),
				).toEqual(Buffer.from("safe"));
			}
		});
	});
});
