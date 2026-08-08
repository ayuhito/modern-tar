import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect } from "vitest";
import { unpackTar } from "../../../src/fs";
import { packTar } from "../../../src/web";
import { it } from "../../helpers/test";

const deepName = `${"a/".repeat(39)}file.txt`;
const depthBoundaryCases = [
	{ name: "file.txt", output: ["file.txt"], maxDepth: 0, succeeds: true },
	{
		name: "a/file.txt",
		output: ["a", "file.txt"],
		maxDepth: 1,
		succeeds: false,
	},
	{
		name: "a/file.txt",
		output: ["a", "file.txt"],
		maxDepth: 2,
		succeeds: true,
	},
	{
		name: deepName,
		output: [...Array<string>(39).fill("a"), "file.txt"],
		maxDepth: 39,
		succeeds: false,
	},
	{
		name: deepName,
		output: [...Array<string>(39).fill("a"), "file.txt"],
		maxDepth: 40,
		succeeds: true,
	},
	{
		name: "a\\file.txt",
		output: ["a", "file.txt"],
		maxDepth: 1,
		succeeds: false,
	},
];

describe("resource limits", () => {
	it("enforces maxDepth boundaries before writing", async ({ tmpDir }) => {
		for (const [index, testCase] of depthBoundaryCases.entries()) {
			const extractDir = path.join(tmpDir, String(index));
			const archive = await packTar([
				{
					header: { name: testCase.name, size: 4, type: "file" },
					body: "test",
				},
			]);
			const extraction = pipeline(
				Readable.from([archive]),
				unpackTar(extractDir, { maxDepth: testCase.maxDepth }),
			);

			if (testCase.succeeds) {
				await expect(extraction).resolves.toBeUndefined();
				expect(
					await fs.readFile(path.join(extractDir, ...testCase.output), "utf8"),
				).toBe("test");
			} else {
				await expect(extraction).rejects.toThrow(
					"Tar exceeds max specified depth.",
				);
				await expect(
					fs.access(path.join(extractDir, testCase.output[0])),
				).rejects.toThrow();
			}
		}
	});

	it("enforces the default maxDepth before writing", async ({ tmpDir }) => {
		const extractDir = path.join(tmpDir, "default-depth");
		const name = `${"a/".repeat(1024)}file.txt`;
		const archive = await packTar([
			{
				header: { name, size: 4, type: "file" },
				body: "test",
			},
		]);

		await expect(
			pipeline(Readable.from([archive]), unpackTar(extractDir)),
		).rejects.toThrow("Tar exceeds max specified depth.");
		await expect(fs.access(path.join(extractDir, "a"))).rejects.toThrow();
	});

	it("allows unlimited path depth explicitly", async ({ tmpDir }) => {
		const extractDir = path.join(tmpDir, "extract");
		const name = `${"a/".repeat(50)}file.txt`;
		const archive = await packTar([
			{
				header: { name, size: 4, type: "file" },
				body: "test",
			},
		]);

		await pipeline(
			Readable.from([archive]),
			unpackTar(extractDir, { maxDepth: Infinity }),
		);

		expect(await fs.readFile(path.join(extractDir, name), "utf8")).toBe("test");
	});
});
