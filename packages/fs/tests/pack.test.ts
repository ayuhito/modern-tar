import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packTar, unpackTar } from "../src/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

// Helper to get mtime in seconds, like in tar headers
const mtime = (stat: { mtime: Date }) =>
	Math.floor(stat.mtime.getTime() / 1000);

describe("pack", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "modern-tar-pack-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("packs and extracts a directory with a single file", async () => {
		const sourceDir = path.join(FIXTURES_DIR, "a");
		const destDir = path.join(tmpDir, "extracted");

		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		const files = await fs.readdir(destDir);
		expect(files).toHaveLength(1);
		expect(files[0]).toBe("hello.txt");

		const originalPath = path.join(sourceDir, "hello.txt");
		const copiedPath = path.join(destDir, "hello.txt");

		const originalContent = await fs.readFile(originalPath, "utf-8");
		const copiedContent = await fs.readFile(copiedPath, "utf-8");
		expect(copiedContent).toBe(originalContent);

		const originalStat = await fs.stat(originalPath);
		const copiedStat = await fs.stat(copiedPath);
		expect(copiedStat.mode).toBe(originalStat.mode);
		expect(mtime(copiedStat)).toBe(mtime(originalStat));
	});

	it("packs and extracts a nested directory", async () => {
		const sourceDir = path.join(FIXTURES_DIR, "b");
		const destDir = path.join(tmpDir, "extracted");

		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		const rootFiles = await fs.readdir(destDir);
		expect(rootFiles).toEqual(["a"]);

		const nestedFiles = await fs.readdir(path.join(destDir, "a"));
		expect(nestedFiles).toEqual(["test.txt"]);

		const originalPath = path.join(sourceDir, "a", "test.txt");
		const copiedPath = path.join(destDir, "a", "test.txt");

		const originalContent = await fs.readFile(originalPath, "utf-8");
		const copiedContent = await fs.readFile(copiedPath, "utf-8");
		expect(copiedContent).toBe(originalContent);
	});

	it("handles USTAR long filenames on a round trip", async () => {
		const longDirName =
			"a-very-long-directory-name-that-is-over-100-characters-long";
		const nestedDirName =
			"and-needs-to-be-split-between-the-prefix-and-name-fields";
		const fileName = "file.txt";

		const sourceDir = path.join(tmpDir, "source");
		const longPath = path.join(sourceDir, longDirName, nestedDirName);
		const fullPath = path.join(longPath, fileName);

		await fs.mkdir(longPath, { recursive: true });
		await fs.writeFile(fullPath, "long path test");

		const destDir = path.join(tmpDir, "extracted");
		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		const extractedFile = path.join(
			destDir,
			longDirName,
			nestedDirName,
			fileName,
		);
		const content = await fs.readFile(extractedFile, "utf-8");
		expect(content).toBe("long path test");
	});

	it("filters entries on pack", async () => {
		const sourceDir = path.join(FIXTURES_DIR, "c");
		const destDir = path.join(tmpDir, "extracted");

		const packStream = packTar(sourceDir, {
			filter: (filePath) => path.basename(filePath) !== ".gitignore",
		});
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		const files = await fs.readdir(destDir);
		expect(files.includes(".gitignore")).toBe(false);
	});
});
