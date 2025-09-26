import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packTar, unpackTar } from "../../src/fs";

describe("links", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "modern-tar-links-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it.skipIf(process.platform === "win32")("handles symlinks", async () => {
		const sourceDir = path.join(tmpDir, "source");
		await fs.mkdir(sourceDir, { recursive: true });

		// Create a file and a symlink to it
		const targetFile = path.join(sourceDir, ".gitignore");
		const linkFile = path.join(sourceDir, "link");

		await fs.writeFile(targetFile, "node_modules/\n");
		await fs.symlink(".gitignore", linkFile);

		const destDir = path.join(tmpDir, "extracted");
		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		const files = (await fs.readdir(destDir)).sort();
		expect(files).toEqual([".gitignore", "link"]);

		const copiedLinkPath = path.join(destDir, "link");
		const linkStat = await fs.lstat(copiedLinkPath);
		expect(linkStat.isSymbolicLink()).toBe(true);

		const linkTarget = await fs.readlink(copiedLinkPath);
		expect(linkTarget).toBe(".gitignore");
	});

	it.skipIf(process.platform === "win32")(
		"dereferences symlinks when specified",
		async () => {
			const sourceDir = path.join(tmpDir, "source");
			await fs.mkdir(sourceDir, { recursive: true });

			// Create a file and a symlink to it
			const targetFile = path.join(sourceDir, ".gitignore");
			const linkFile = path.join(sourceDir, "link");

			await fs.writeFile(targetFile, "node_modules/\n");
			await fs.symlink(".gitignore", linkFile);

			const destDir = path.join(tmpDir, "extracted");
			const packStream = packTar(sourceDir, { dereference: true });
			const unpackStream = unpackTar(destDir);

			await pipeline(packStream, unpackStream);

			const files = (await fs.readdir(destDir)).sort();
			expect(files).toEqual([".gitignore", "link"]);

			const copiedLinkPath = path.join(destDir, "link");
			const linkStat = await fs.lstat(copiedLinkPath);
			expect(linkStat.isSymbolicLink()).toBe(false); // It should be a file now
			expect(linkStat.isFile()).toBe(true);

			const originalContent = await fs.readFile(targetFile);
			const copiedContent = await fs.readFile(copiedLinkPath);
			expect(copiedContent).toEqual(originalContent);
		},
	);

	it.skipIf(process.platform === "win32")("handles hard links", async () => {
		const sourceDir = path.join(tmpDir, "source");
		await fs.mkdir(sourceDir, { recursive: true });

		// Create a file and a hard link to it
		const originalFilePath = path.join(sourceDir, "hardlink-a.txt");
		const hardlinkPath = path.join(sourceDir, "hardlink-b.txt");

		await fs.writeFile(originalFilePath, "hardlink test content\n");
		await fs.link(originalFilePath, hardlinkPath);

		const destDir = path.join(tmpDir, "extracted");
		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		const originalExtractedPath = path.join(destDir, "hardlink-a.txt");
		const hardlinkExtractedPath = path.join(destDir, "hardlink-b.txt");

		const stat1 = await fs.stat(originalExtractedPath);
		const stat2 = await fs.stat(hardlinkExtractedPath);

		// Check that they point to the same inode
		expect(stat1.ino).toBe(stat2.ino);
		// Check that the link count is 2
		expect(stat1.nlink).toBe(2);
		expect(stat2.nlink).toBe(2);

		const content = await fs.readFile(hardlinkExtractedPath, "utf-8");
		const originalContent = await fs.readFile(originalFilePath, "utf-8");
		expect(content).toBe(originalContent);
	});

	it.skipIf(process.platform === "win32")(
		"preserves symlink timestamps",
		async () => {
			const sourceDir = path.join(tmpDir, "source");
			await fs.mkdir(sourceDir, { recursive: true });

			const targetFile = path.join(sourceDir, "target.txt");
			const linkFile = path.join(sourceDir, "link");

			await fs.writeFile(targetFile, "content");
			await fs.symlink("target.txt", linkFile);

			// Set a specific timestamp on the symlink
			const testTime = new Date("2023-01-01T12:00:00Z");
			await fs.lutimes(linkFile, testTime, testTime);

			const destDir = path.join(tmpDir, "extracted");
			const packStream = packTar(sourceDir);
			const unpackStream = unpackTar(destDir);

			await pipeline(packStream, unpackStream);

			const extractedLink = path.join(destDir, "link");
			const linkStat = await fs.lstat(extractedLink);

			// Check that it's still a symlink and has approximately the right timestamp
			expect(linkStat.isSymbolicLink()).toBe(true);
			// Note: Due to platform differences and tar precision, we check within a reasonable range
			const timeDiff = Math.abs(linkStat.mtime.getTime() - testTime.getTime());
			expect(timeDiff).toBeLessThan(2000); // Within 2 seconds
		},
	);
});
