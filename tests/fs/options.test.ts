import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { describe, expect } from "vitest";
import { packTar, unpackTar } from "../../src/fs";
import { it } from "../helpers/test";
import { writeTree } from "../helpers/tree";

describe("options fs", () => {
	describe("pack options fs", () => {
		it("uses dereference option to follow symlinks", async ({ tmpDir }) => {
			const sourceDir = await writeTree(path.join(tmpDir, "source"), {
				"target.txt": "target content",
			});
			await fs.symlink("target.txt", path.join(sourceDir, "link.txt"));

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

		it("uses filter option with fs.Stats", async ({ tmpDir }) => {
			const sourceDir = await writeTree(path.join(tmpDir, "source"), {
				"small.txt": "small",
				"large.txt": "large content here",
			});

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

		it("filters filesystem sources using source paths", async ({ tmpDir }) => {
			const sensitiveFile = path.join(tmpDir, "secret.txt");
			await fs.writeFile(sensitiveFile, "top-secret");

			const packStream = packTar(
				[
					{
						type: "file",
						source: sensitiveFile,
						target: "safe/secret.txt",
					},
				],
				{
					filter: (filePath) => !path.isAbsolute(filePath),
				},
			);

			const extractDir = path.join(tmpDir, "extract-filter-source");
			const unpackStream = unpackTar(extractDir);
			await pipeline(packStream, unpackStream);

			await expect(
				fs.readFile(path.join(extractDir, "safe", "secret.txt"), "utf-8"),
			).rejects.toThrow();
		});

		it("uses map option to transform headers", async ({ tmpDir }) => {
			const sourceDir = await writeTree(path.join(tmpDir, "source"), {
				"hello.txt": "hello world\n",
			});
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

		it("multiple options", async ({ tmpDir }) => {
			const sourceDir = await writeTree(path.join(tmpDir, "source"), {
				"file1.txt": "content1",
				"file2.log": "content2",
				"subdir/nested.txt": "nested",
			});
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

			const expectedFiles = [
				"file1.txt",
				"link.txt",
				"subdir",
				path.join("subdir", "nested.txt"),
			];

			expect(sortedFiles).toEqual(expectedFiles.sort());

			// Verify symlink was dereferenced
			const linkStat = await fs.lstat(path.join(extractDir, "link.txt"));
			expect(linkStat.isFile()).toBe(true);

			// Verify .log file was filtered out
			expect(files).not.toContain("file2.log");
		});
	});

	describe("unpack options fs", () => {
		it("uses fmode to override file permissions", async ({ tmpDir }) => {
			const sourceDir = await writeTree(path.join(tmpDir, "source"), {
				"test.txt": "content",
			});

			const packStream = packTar(sourceDir);
			const extractDir = path.join(tmpDir, "extract");

			const unpackStream = unpackTar(extractDir, {
				fmode: 0o600, // Read/write for owner only
			});

			await pipeline(packStream, unpackStream);

			const fileStat = await fs.stat(path.join(extractDir, "test.txt"));
			if (process.platform !== "win32") {
				expect(fileStat.mode & 0o777).toBe(0o600);
			} else {
				// Windows handles permissions differently
				expect(fileStat.mode & 0o777).toBeGreaterThan(0);
			}
		});

		it("uses dmode to override directory permissions", async ({ tmpDir }) => {
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
			if (process.platform !== "win32") {
				expect(dirStat.mode & 0o777).toBe(0o700);
			} else {
				// Windows handles permissions differently
				expect(dirStat.mode & 0o777).toBeGreaterThan(0);
			}
		});

		it("inherits core strip option", async ({ tmpDir }) => {
			const sourceDir = await writeTree(path.join(tmpDir, "source"), {
				"a/test.txt": "test\n",
			});
			const packStream = packTar(sourceDir);
			const extractDir = path.join(tmpDir, "extract");

			const unpackStream = unpackTar(extractDir, {
				strip: 1, // Remove first path component
			});

			await pipeline(packStream, unpackStream);

			const files = await fs.readdir(extractDir);
			expect(files).toContain("test.txt");
		});

		it.skipIf(process.platform === "win32")(
			"strips hardlink linknames with strip option",
			async ({ tmpDir }) => {
				const binDir = path.join(tmpDir, "source", "wrapper", "bin");
				await fs.mkdir(binDir, { recursive: true });
				await fs.writeFile(path.join(binDir, "python3.6"), "python\n");
				await fs.link(
					path.join(binDir, "python3.6"),
					path.join(binDir, "python3.6m"),
				);

				const extractDir = path.join(tmpDir, "extract");
				await pipeline(
					packTar(path.join(tmpDir, "source")),
					unpackTar(extractDir, { strip: 1 }),
				);

				const s1 = await fs.stat(path.join(extractDir, "bin", "python3.6"));
				const s2 = await fs.stat(path.join(extractDir, "bin", "python3.6m"));
				expect(s1.ino).toBe(s2.ino);
			},
		);

		it("inherits core filter option", async ({ tmpDir }) => {
			const sourceDir = await writeTree(path.join(tmpDir, "source"), {
				"keep.txt": "keep",
				"skip.js": "skip",
			});

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

		it("inherits core map option", async ({ tmpDir }) => {
			const sourceDir = await writeTree(path.join(tmpDir, "source"), {
				"file.txt": "content",
			});

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

		it("combines core options with filesystem options", async ({ tmpDir }) => {
			const sourceDir = await writeTree(path.join(tmpDir, "source"), {
				"hello.txt": "hello world\n",
			});
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
			if (process.platform !== "win32") {
				expect(fileStat.mode & 0o777).toBe(0o600);
			} else {
				// Windows handles permissions differently
				expect(fileStat.mode & 0o777).toBeGreaterThan(0);
			}
		});

		it("preserves original permissions when fmode/dmode not specified", async ({
			tmpDir,
		}) => {
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

			if (process.platform !== "win32") {
				expect(fileStat.mode & 0o777).toBe(0o755);
				expect(dirStat.mode & 0o777).toBe(0o700);
			} else {
				// Windows handles permissions differently
				expect(fileStat.mode & 0o777).toBeGreaterThan(0);
				expect(dirStat.mode & 0o777).toBeGreaterThan(0);
			}
		});
	});

	it("drops entries when strip exceeds their path depth", async ({
		tmpDir,
	}) => {
		const sourceDir = await writeTree(path.join(tmpDir, "source"), {
			"hello.txt": "hello world\n",
		});
		const extractDir = path.join(tmpDir, "extract");

		await pipeline(packTar(sourceDir), unpackTar(extractDir, { strip: 999 }));

		expect(await fs.readdir(extractDir)).toEqual([]);
	});
});
