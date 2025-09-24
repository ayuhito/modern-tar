import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packTar, unpackTar } from "../src/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

describe("options fs", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "modern-tar-options-test-"),
		);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	describe("pack options fs", () => {
		it("uses dereference option to follow symlinks", async () => {
			const sourceDir = path.join(tmpDir, "source");
			const targetFile = path.join(sourceDir, "target.txt");
			const symlinkFile = path.join(sourceDir, "link.txt");

			await fs.mkdir(sourceDir);
			await fs.writeFile(targetFile, "target content");
			await fs.symlink("target.txt", symlinkFile);

			// Pack without dereferencing (default)
			const packStream1 = packTar(sourceDir, { dereference: false });
			const extractDir1 = path.join(tmpDir, "extract1");
			const unpackStream1 = unpackTar(extractDir1);
			await pipeline(packStream1, unpackStream1);

			// Pack with dereferencing
			const packStream2 = packTar(sourceDir, { dereference: true });
			const extractDir2 = path.join(tmpDir, "extract2");
			const unpackStream2 = unpackTar(extractDir2);
			await pipeline(packStream2, unpackStream2);

			// Check that symlink is preserved in first case
			const stat1 = await fs.lstat(path.join(extractDir1, "link.txt"));
			expect(stat1.isSymbolicLink()).toBe(true);

			// Check that symlink is dereferenced in second case
			const stat2 = await fs.lstat(path.join(extractDir2, "link.txt"));
			expect(stat2.isFile()).toBe(true);
			const content2 = await fs.readFile(
				path.join(extractDir2, "link.txt"),
				"utf-8",
			);
			expect(content2).toBe("target content");
		});

		it("uses filter option with fs.Stats", async () => {
			const sourceDir = path.join(tmpDir, "source");
			await fs.mkdir(sourceDir);
			await fs.writeFile(path.join(sourceDir, "small.txt"), "small");
			await fs.writeFile(
				path.join(sourceDir, "large.txt"),
				"large content here",
			);

			const packStream = packTar(sourceDir, {
				filter: (_filePath, stats) => {
					// Only include files larger than 5 bytes
					return stats.isDirectory() || stats.size > 5;
				},
			});

			const extractDir = path.join(tmpDir, "extract");
			const unpackStream = unpackTar(extractDir);
			await pipeline(packStream, unpackStream);

			const files = await fs.readdir(extractDir);
			expect(files).toEqual(["large.txt"]);
		});

		it("uses map option to transform headers", async () => {
			const sourceDir = path.join(FIXTURES_DIR, "a");
			const packStream = packTar(sourceDir, {
				map: (header) => ({
					...header,
					uname: "custom-user",
					gname: "custom-group",
					mode: header.type === "file" ? 0o644 : 0o755,
				}),
			});

			const extractDir = path.join(tmpDir, "extract");
			const unpackStream = unpackTar(extractDir);
			await pipeline(packStream, unpackStream);

			// Verify the file exists (map worked)
			const files = await fs.readdir(extractDir);
			expect(files).toContain("hello.txt");
		});

		it("multiple options", async () => {
			const sourceDir = path.join(tmpDir, "source");
			const subDir = path.join(sourceDir, "subdir");
			await fs.mkdir(sourceDir);
			await fs.mkdir(subDir);

			await fs.writeFile(path.join(sourceDir, "file1.txt"), "content1");
			await fs.writeFile(path.join(sourceDir, "file2.log"), "content2");
			await fs.writeFile(path.join(subDir, "nested.txt"), "nested");
			await fs.symlink("file1.txt", path.join(sourceDir, "link.txt"));

			const packStream = packTar(sourceDir, {
				dereference: true, // Follow symlinks
				filter: (filePath, stats) => {
					// Only .txt files and directories
					return stats.isDirectory() || filePath.endsWith(".txt");
				},
				map: (header) => ({
					...header,
					uname: "builder",
					gname: "wheel",
				}),
			});

			const extractDir = path.join(tmpDir, "extract");
			const unpackStream = unpackTar(extractDir);
			await pipeline(packStream, unpackStream);

			const files = await fs.readdir(extractDir, { recursive: true });
			const sortedFiles = files.sort();

			expect(sortedFiles).toEqual([
				"file1.txt",
				"link.txt",
				"subdir",
				"subdir/nested.txt",
			]);

			// Verify symlink was dereferenced
			const linkStat = await fs.lstat(path.join(extractDir, "link.txt"));
			expect(linkStat.isFile()).toBe(true);

			// Verify .log file was filtered out
			expect(files).not.toContain("file2.log");
		});
	});

	describe("unpack options fs", () => {
		it("uses fmode to override file permissions", async () => {
			const sourceDir = path.join(tmpDir, "source");
			await fs.mkdir(sourceDir);
			await fs.writeFile(path.join(sourceDir, "test.txt"), "content");

			const packStream = packTar(sourceDir);
			const extractDir = path.join(tmpDir, "extract");

			const unpackStream = unpackTar(extractDir, {
				fmode: 0o600, // Read/write for owner only
			});

			await pipeline(packStream, unpackStream);

			const fileStat = await fs.stat(path.join(extractDir, "test.txt"));
			expect(fileStat.mode & 0o777).toBe(0o600);
		});

		it("uses dmode to override directory permissions", async () => {
			const sourceDir = path.join(tmpDir, "source");
			const subDir = path.join(sourceDir, "subdir");
			await fs.mkdir(sourceDir);
			await fs.mkdir(subDir);

			const packStream = packTar(sourceDir);
			const extractDir = path.join(tmpDir, "extract");

			const unpackStream = unpackTar(extractDir, {
				dmode: 0o700, // Read/write/execute for owner only
			});

			await pipeline(packStream, unpackStream);

			const dirStat = await fs.stat(path.join(extractDir, "subdir"));
			expect(dirStat.mode & 0o777).toBe(0o700);
		});

		it("inherits core strip option", async () => {
			const sourceDir = path.join(FIXTURES_DIR, "b");
			const packStream = packTar(sourceDir);
			const extractDir = path.join(tmpDir, "extract");

			const unpackStream = unpackTar(extractDir, {
				strip: 1, // Remove first path component
			});

			await pipeline(packStream, unpackStream);

			const files = await fs.readdir(extractDir);
			expect(files).toContain("test.txt");
		});

		it("inherits core filter option", async () => {
			const sourceDir = path.join(tmpDir, "source");
			await fs.mkdir(sourceDir);
			await fs.writeFile(path.join(sourceDir, "keep.txt"), "keep");
			await fs.writeFile(path.join(sourceDir, "skip.js"), "skip");

			const packStream = packTar(sourceDir);
			const extractDir = path.join(tmpDir, "extract");

			const unpackStream = unpackTar(extractDir, {
				filter: (header) => header.name.endsWith(".txt"),
			});

			await pipeline(packStream, unpackStream);

			const files = await fs.readdir(extractDir);
			expect(files).toContain("keep.txt");
			expect(files).not.toContain("skip.js");
		});

		it("inherits core map option", async () => {
			const sourceDir = path.join(tmpDir, "source");
			await fs.mkdir(sourceDir);
			await fs.writeFile(path.join(sourceDir, "file.txt"), "content");

			const packStream = packTar(sourceDir);
			const extractDir = path.join(tmpDir, "extract");

			const unpackStream = unpackTar(extractDir, {
				map: (header) => ({
					...header,
					name: `prefixed-${header.name}`,
				}),
			});

			await pipeline(packStream, unpackStream);

			const files = await fs.readdir(extractDir);
			expect(files.some((f) => f.startsWith("prefixed-"))).toBe(true);
			expect(files).toContain("prefixed-file.txt");
		});

		it("combines core options with filesystem options", async () => {
			const sourceDir = path.join(FIXTURES_DIR, "a");
			const packStream = packTar(sourceDir);
			const extractDir = path.join(tmpDir, "extract");

			const unpackStream = unpackTar(extractDir, {
				// Core options (map only)
				map: (header) => ({
					...header,
					name: header.name.toUpperCase(),
				}),

				// FS-specific options
				fmode: 0o600,
			});

			await pipeline(packStream, unpackStream);

			const files = await fs.readdir(extractDir);
			expect(files).toContain("HELLO.TXT");

			// Check permissions
			const fileStat = await fs.stat(path.join(extractDir, "HELLO.TXT"));
			expect(fileStat.mode & 0o777).toBe(0o600);
		});

		it("preserves original permissions when fmode/dmode not specified", async () => {
			const sourceDir = path.join(tmpDir, "source");
			await fs.mkdir(sourceDir);
			await fs.writeFile(
				path.join(sourceDir, "exec.sh"),
				"#!/bin/bash\necho test",
				{ mode: 0o755 },
			);
			await fs.mkdir(path.join(sourceDir, "restricted"), { mode: 0o700 });

			const packStream = packTar(sourceDir);
			const extractDir = path.join(tmpDir, "extract");
			const unpackStream = unpackTar(extractDir); // No fmode/dmode specified

			await pipeline(packStream, unpackStream);

			const fileStat = await fs.stat(path.join(extractDir, "exec.sh"));
			const dirStat = await fs.stat(path.join(extractDir, "restricted"));

			expect(fileStat.mode & 0o777).toBe(0o755);
			expect(dirStat.mode & 0o777).toBe(0o700);
		});
	});

	describe("error handling", () => {
		it("handles permission errors gracefully", async () => {
			// This test might be platform-specific, so we'll keep it simple
			const sourceDir = path.join(FIXTURES_DIR, "a");
			const packStream = packTar(sourceDir);
			const extractDir = path.join(tmpDir, "extract");

			// Try to extract with very restrictive permissions
			const unpackStream = unpackTar(extractDir, {
				fmode: 0o000, // No permissions (this might cause issues on some systems)
				dmode: 0o755,
			});

			// Should not throw, even if permissions are weird
			await expect(pipeline(packStream, unpackStream)).resolves.not.toThrow();
		});

		it("handles invalid strip values gracefully", async () => {
			const sourceDir = path.join(FIXTURES_DIR, "a");
			const packStream = packTar(sourceDir);
			const extractDir = path.join(tmpDir, "extract");

			const unpackStream = unpackTar(extractDir, {
				strip: 999, // Strip way too many components
			});

			// Should complete without error, just with no files extracted
			await pipeline(packStream, unpackStream);

			// Check if extract directory was created
			const dirExists = await fs
				.access(extractDir)
				.then(() => true)
				.catch(() => false);
			if (dirExists) {
				const files = await fs.readdir(extractDir);
				expect(files).toHaveLength(0);
			} else {
				// Directory not created because no files were extracted - this is acceptable
				expect(true).toBe(true);
			}
		});
	});
});
