import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packTar, unpackTar } from "../src/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

describe("extract", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "modern-tar-extract-test-"),
		);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("strips path components on extract", async () => {
		const sourceDir = path.join(FIXTURES_DIR, "b");
		const destDir = path.join(tmpDir, "extracted");

		const packStream = packTar(sourceDir);
		await packStream.pipeTo(unpackTar(destDir, { strip: 1 }));

		const files = await fs.readdir(destDir);
		expect(files).toEqual(["test.txt"]);
	});

	it("maps headers on extract", async () => {
		const sourceDir = path.join(FIXTURES_DIR, "a");
		const destDir = path.join(tmpDir, "extracted");

		const packStream = packTar(sourceDir);
		await packStream.pipeTo(
			unpackTar(destDir, {
				map: (header) => {
					header.name = `prefixed/${header.name}`;
					return header;
				},
			}),
		);

		const files = await fs.readdir(path.join(destDir, "prefixed"));
		expect(files).toEqual(["hello.txt"]);
	});

	it("filters entries on extract", async () => {
		const sourceDir = path.join(FIXTURES_DIR, "c");
		const destDir = path.join(tmpDir, "extracted");

		const packStream = packTar(sourceDir);
		await packStream.pipeTo(
			unpackTar(destDir, {
				filter: (header) => header.name !== ".gitignore",
			}),
		);

		const files = await fs.readdir(destDir);
		expect(files.includes(".gitignore")).toBe(false);
	});

	it("extracts files with correct permissions", async () => {
		const sourceDir = path.join(FIXTURES_DIR, "a");
		const destDir = path.join(tmpDir, "extracted");

		const packStream = packTar(sourceDir);
		await packStream.pipeTo(unpackTar(destDir));

		const originalStat = await fs.stat(path.join(sourceDir, "hello.txt"));
		const extractedStat = await fs.stat(path.join(destDir, "hello.txt"));

		expect(extractedStat.mode).toBe(originalStat.mode);
	});
});
