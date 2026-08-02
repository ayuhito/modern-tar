import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect } from "vitest";
import { unpackTar } from "../../../src/fs";
import { packTar } from "../../../src/web";
import { it } from "../../helpers/test";

describe("resource limits", () => {
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
