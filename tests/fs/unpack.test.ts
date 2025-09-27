import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packTar, unpackTar } from "../../src/fs";
import { packTar as packTarWeb } from "../../src/web";

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
		const unpackStream = unpackTar(destDir, { strip: 1 });

		await pipeline(packStream, unpackStream);

		const files = await fs.readdir(destDir);
		expect(files).toEqual(["test.txt"]);
	});

	it("maps headers on extract", async () => {
		const sourceDir = path.join(FIXTURES_DIR, "a");
		const destDir = path.join(tmpDir, "extracted");

		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir, {
			map: (header) => {
				header.name = `prefixed/${header.name}`;
				return header;
			},
		});

		await pipeline(packStream, unpackStream);

		const files = await fs.readdir(path.join(destDir, "prefixed"));
		expect(files).toEqual(["hello.txt"]);
	});

	it("filters entries on extract", async () => {
		const sourceDir = path.join(FIXTURES_DIR, "c");
		const destDir = path.join(tmpDir, "extracted");

		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir, {
			filter: (header) => header.name !== ".gitignore",
		});

		await pipeline(packStream, unpackStream);

		const files = await fs.readdir(destDir);
		expect(files.includes(".gitignore")).toBe(false);
	});

	it("extracts files with correct permissions", async () => {
		const sourceDir = path.join(FIXTURES_DIR, "a");
		const destDir = path.join(tmpDir, "extracted");

		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		const originalStat = await fs.stat(path.join(sourceDir, "hello.txt"));
		const extractedStat = await fs.stat(path.join(destDir, "hello.txt"));

		expect(extractedStat.mode).toBe(originalStat.mode);
	});

	it("safely skips unsupported file types", async () => {
		const destDir = path.join(tmpDir, "extracted");

		const entries = [
			{
				header: {
					name: "normal-file.txt",
					size: 12,
					type: "file" as const,
				},
				body: "hello world\n",
			},
			{
				header: {
					name: "char-device",
					size: 0,
					type: "character-device" as const,
				},
			},
			{
				header: {
					name: "block-device",
					size: 0,
					type: "block-device" as const,
				},
			},
			{
				header: {
					name: "fifo-pipe",
					size: 0,
					type: "fifo" as const,
				},
			},
		];

		const tarBuffer = await packTarWeb(entries);

		const unpackStream = unpackTar(destDir);
		await pipeline(Readable.from([tarBuffer]), unpackStream);

		// Check that only the normal file was extracted
		const files = await fs.readdir(destDir);
		expect(files).toEqual(["normal-file.txt"]);

		// Verify the normal file was extracted correctly
		const content = await fs.readFile(
			path.join(destDir, "normal-file.txt"),
			"utf8",
		);
		expect(content).toBe("hello world\n");
	});
});
