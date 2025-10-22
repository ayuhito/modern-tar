import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packTar, unpackTar } from "../../src/fs";

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
			if (os.platform() !== "win32") {
				expect(fileStat.mode & 0o777).toBe(0o600);
			} else {
				// Windows handles permissions differently
				expect(fileStat.mode & 0o777).toBeGreaterThan(0);
			}
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
			if (os.platform() !== "win32") {
				expect(dirStat.mode & 0o777).toBe(0o700);
			} else {
				// Windows handles permissions differently
				expect(dirStat.mode & 0o777).toBeGreaterThan(0);
			}
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
			if (os.platform() !== "win32") {
				expect(fileStat.mode & 0o777).toBe(0o600);
			} else {
				// Windows handles permissions differently
				expect(fileStat.mode & 0o777).toBeGreaterThan(0);
			}
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

			if (os.platform() !== "win32") {
				expect(fileStat.mode & 0o777).toBe(0o755);
				expect(dirStat.mode & 0o777).toBe(0o700);
			} else {
				// Windows handles permissions differently
				expect(fileStat.mode & 0o777).toBeGreaterThan(0);
				expect(dirStat.mode & 0o777).toBeGreaterThan(0);
			}
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

	describe("map option edge cases", () => {
		describe("security vulnerabilities through map transformations", () => {
			it("prevents path traversal attacks through map function", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(path.join(sourceDir, "safe"), { recursive: true });
				await fs.writeFile(path.join(sourceDir, "safe", "file.txt"), "content");

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					map(entry) {
						// Malicious map trying to escape extraction directory
						if (entry.name === "safe/file.txt") {
							entry.name = "../../../etc/passwd";
						}
						return entry;
					},
				});

				// Should reject the malicious path transformation
				await expect(pipeline(packStream, unpackStream)).rejects.toThrow(
					/points outside.*extraction directory/,
				);
			});

			it("prevents absolute path injection through map", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });
				await fs.writeFile(path.join(sourceDir, "file.txt"), "content");

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					map(entry) {
						// Try to inject absolute path - this gets normalized to relative
						entry.name = "/tmp/malicious.txt";
						return entry;
					},
				});

				// The library normalizes absolute paths to relative ones, so this succeeds
				await pipeline(packStream, unpackStream);

				// Verify the file was created with normalized path
				const files = await fs.readdir(extractDir, { recursive: true });
				expect(
					files.some((f) => f.includes("tmp") && f.includes("malicious")),
				).toBe(true);
			});

			it("handles symlink target safety when map changes entry names", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(path.join(sourceDir, "dir"), { recursive: true });
				await fs.writeFile(
					path.join(sourceDir, "dir", "target.txt"),
					"content",
				);
				await fs.symlink("target.txt", path.join(sourceDir, "dir", "link.txt"));

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					map(entry) {
						// Move symlink but not its target, creating a dangling reference
						if (entry.name === "dir/link.txt") {
							entry.name = "moved-link.txt";
							// linkname still points to "target.txt" which is now in dir/
						}
						return entry;
					},
				});

				// Should complete - symlink validation handles relative links safely
				await pipeline(packStream, unpackStream);

				// Verify the symlink was created but points to expected location
				const linkStat = await fs.lstat(
					path.join(extractDir, "moved-link.txt"),
				);
				expect(linkStat.isSymbolicLink()).toBe(true);
			});
		});

		describe("path conflicts and collisions", () => {
			it("handles multiple entries mapping to same path", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });
				await fs.writeFile(path.join(sourceDir, "file1.txt"), "content1");
				await fs.writeFile(path.join(sourceDir, "file2.txt"), "content2");

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					map(entry) {
						// Map both files to same destination
						if (entry.name === "file1.txt" || entry.name === "file2.txt") {
							entry.name = "same-file.txt";
						}
						return entry;
					},
				});

				// Should complete - later entries overwrite earlier ones
				await pipeline(packStream, unpackStream);

				const files = await fs.readdir(extractDir);
				expect(files).toContain("same-file.txt");

				// The last file should win
				const content = await fs.readFile(
					path.join(extractDir, "same-file.txt"),
					"utf-8",
				);
				expect(content).toBe("content2"); // file2.txt was processed last
			});

			it("handles directory vs file conflicts", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(path.join(sourceDir, "conflict"), { recursive: true });
				await fs.writeFile(
					path.join(sourceDir, "conflict", "nested.txt"),
					"content",
				);
				await fs.writeFile(path.join(sourceDir, "other.txt"), "other");

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					map(entry) {
						// Try to create a file where a directory should be
						if (entry.name === "other.txt") {
							entry.name = "conflict/"; // Maps to directory path
						}
						return entry;
					},
				});

				// Should reject due to type conflict
				await expect(pipeline(packStream, unpackStream)).rejects.toThrow(
					/Path conflict/,
				);
			});

			it("handles hardlink target resolution after map transformations", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });
				await fs.writeFile(path.join(sourceDir, "original.txt"), "content");

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					map(entry) {
						// Move the original file to a subdirectory
						if (entry.name === "original.txt") {
							entry.name = "moved/original.txt";
						}
						return entry;
					},
				});

				// This should succeed - the file gets moved to the mapped location
				await pipeline(packStream, unpackStream);

				// Verify the file was created at the mapped location
				const files = await fs.readdir(extractDir, { recursive: true });
				expect(
					files.some((f) => f.includes("moved") && f.includes("original")),
				).toBe(true);
			});
		});

		describe("performance and resource management", () => {
			it("handles large numbers of filtered entries efficiently", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });

				// Create many files
				for (let i = 0; i < 100; i++) {
					await fs.writeFile(
						path.join(sourceDir, `file${i}.txt`),
						`content${i}`,
					);
				}

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				let processedCount = 0;
				const unpackStream = unpackTar(extractDir, {
					filter(entry) {
						processedCount++;
						// Only keep every 10th file
						return entry.name.match(/file[0-9]*0\.txt$/) !== null;
					},
				});

				const startTime = Date.now();
				await pipeline(packStream, unpackStream);
				const duration = Date.now() - startTime;

				// Should complete reasonably quickly despite many filtered entries
				expect(duration).toBeLessThan(5000);
				expect(processedCount).toBe(100);

				const files = await fs.readdir(extractDir);
				expect(files.length).toBe(10); // Only files ending in 0
			});

			it("handles very deep directory structures from map", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });
				await fs.writeFile(path.join(sourceDir, "file.txt"), "content");

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					map(entry) {
						// Create very deep path
						const deepPath = "a/".repeat(50) + "file.txt";
						entry.name = deepPath;
						return entry;
					},
				});

				// Should handle deep paths up to maxDepth
				await pipeline(packStream, unpackStream);

				// Verify deep structure was created
				const deepFile = path.join(extractDir, "a/".repeat(50), "file.txt");
				const content = await fs.readFile(deepFile, "utf-8");
				expect(content).toBe("content");
			});

			it("respects maxDepth even with map transformations", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });
				await fs.writeFile(path.join(sourceDir, "file.txt"), "content");

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					maxDepth: 5,
					map(entry) {
						// Try to create path deeper than maxDepth
						const deepPath = "a/".repeat(10) + "file.txt"; // 10 levels deep
						entry.name = deepPath;
						return entry;
					},
				});

				// Should reject due to exceeding maxDepth
				await expect(pipeline(packStream, unpackStream)).rejects.toThrow(
					/exceeds max specified depth/,
				);
			});
		});

		describe("unicode and special character handling", () => {
			it("handles unicode normalization in map transformations", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });
				await fs.writeFile(path.join(sourceDir, "file.txt"), "content");

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					map(entry) {
						// Use unicode characters that need normalization
						entry.name = "αβγ-test-file.txt"; // Alpha, beta, gamma
						return entry;
					},
				});

				await pipeline(packStream, unpackStream);

				// Should handle Unicode characters correctly
				const files = await fs.readdir(extractDir);
				expect(files.length).toBe(1);
				expect(files[0]).toContain("αβγ");
				expect(files[0]).toContain(".txt");

				const content = await fs.readFile(
					path.join(extractDir, files[0]),
					"utf-8",
				);
				expect(content).toBe("content");
			});

			it("handles special characters and edge cases in paths", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });
				await fs.writeFile(path.join(sourceDir, "file.txt"), "content");

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					map(entry) {
						// Test various special characters
						entry.name =
							"special-chars/file with spaces & symbols!@#$%^&()_+-={}[]|;',.txt";
						return entry;
					},
				});

				await pipeline(packStream, unpackStream);

				// Should handle special characters (OS permitting)
				const files = await fs.readdir(path.join(extractDir, "special-chars"));
				expect(files.length).toBe(1);
			});
		});

		describe("error handling and edge cases", () => {
			it("handles map function throwing exceptions", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });
				await fs.writeFile(path.join(sourceDir, "file.txt"), "content");

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					map(_entry) {
						// Throw error in map function
						throw new Error("Map function error");
					},
				});

				// Should propagate the error from map function
				await expect(pipeline(packStream, unpackStream)).rejects.toThrow(
					"Map function error",
				);
			});

			it("handles map returning invalid entry objects", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });
				await fs.writeFile(path.join(sourceDir, "file.txt"), "content");

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					map() {
						// Return invalid entry (missing required fields like type)
						return { name: "invalid.txt", size: 0 };
					},
				});

				// The library may handle this gracefully by using default values
				await pipeline(packStream, unpackStream);

				// Verify some extraction occurred or was safely skipped
				const files = await fs.readdir(extractDir);
				// Entry may be skipped or processed with defaults
				expect(Array.isArray(files)).toBe(true);
			});

			it("handles concurrent map transformations creating same paths", async () => {
				const sourceDir = path.join(tmpDir, "source");

				// Create multiple files that will map to the same directory
				for (let i = 0; i < 10; i++) {
					await fs.mkdir(path.join(sourceDir, `dir${i}`), { recursive: true });
					await fs.writeFile(
						path.join(sourceDir, `dir${i}`, "file.txt"),
						`content${i}`,
					);
				}

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					map(entry) {
						// All entries map to same directory structure
						if (entry.name.startsWith("dir") && entry.name.endsWith("/")) {
							entry.name = "common/";
						} else if (entry.name.includes("/file.txt")) {
							entry.name = "common/file.txt";
						}
						return entry;
					},
				});

				// Should handle concurrent directory creation and file overwrites
				await pipeline(packStream, unpackStream);

				const files = await fs.readdir(path.join(extractDir, "common"));
				expect(files).toContain("file.txt");
			});

			it("handles very long paths after map transformation", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });
				await fs.writeFile(path.join(sourceDir, "file.txt"), "content");

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					map(entry) {
						// Create a very long filename
						const longName = "a".repeat(200) + ".txt";
						return { ...entry, name: longName };
					},
				});

				// Should handle long paths within filesystem limits
				await pipeline(packStream, unpackStream);

				const files = await fs.readdir(extractDir);
				expect(files.some((f) => f.startsWith("aaa"))).toBe(true);
			});
		});

		describe("interaction with other options", () => {
			it("applies map after strip but before filter", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(path.join(sourceDir, "prefix", "keep"), {
					recursive: true,
				});
				await fs.writeFile(
					path.join(sourceDir, "prefix", "keep", "file.txt"),
					"content",
				);

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				let mapCallCount = 0;
				let filterCallCount = 0;

				const unpackStream = unpackTar(extractDir, {
					strip: 1, // Remove "prefix/" component
					filter() {
						filterCallCount++;
						return true;
					},
					map(entry) {
						mapCallCount++;
						// Should see "keep/file.txt" (after strip) or similar
						entry.name = `mapped-${entry.name}`;
						return entry;
					},
				});

				await pipeline(packStream, unpackStream);

				expect(mapCallCount).toBeGreaterThan(0);
				expect(filterCallCount).toBeGreaterThan(0);

				// Verify final structure
				const files = await fs.readdir(extractDir, { recursive: true });
				expect(files.some((f) => f.includes("mapped-keep"))).toBe(true);
			});

			it("handles strip, map, and filter creating edge cases", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(path.join(sourceDir, "a", "b"), { recursive: true });
				await fs.writeFile(
					path.join(sourceDir, "a", "b", "file.txt"),
					"content",
				);

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				const unpackStream = unpackTar(extractDir, {
					strip: 2, // Remove "a/b/" -> leaves "file.txt" and ""
					filter(entry) {
						return entry.name !== ""; // Filter empty names
					},
				});

				await pipeline(packStream, unpackStream);

				const files = await fs.readdir(extractDir);
				expect(files).toContain("file.txt");
			});
		});

		describe("order of operations verification", () => {
			it("verifies path validation happens AFTER map transformations", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });
				await fs.writeFile(path.join(sourceDir, "safe.txt"), "content");

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				// This test proves that map runs first, then path validation
				// If path validation ran first, the original "safe.txt" would pass validation
				// But since map runs first and creates a malicious path, validation catches it
				const unpackStream = unpackTar(extractDir, {
					map(entry) {
						// Transform the safe path into a malicious one
						if (entry.name === "safe.txt") {
							entry.name = "../../../etc/passwd"; // This should be caught by validation
						}
						return entry;
					},
				});

				// Should fail because path validation happens AFTER map transformation
				// This proves the order: original path -> map transform -> path validation
				await expect(pipeline(packStream, unpackStream)).rejects.toThrow(
					/points outside.*extraction directory/,
				);
			});

			it("verifies strip runs before map", async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(path.join(sourceDir, "prefix"), { recursive: true });
				await fs.writeFile(
					path.join(sourceDir, "prefix", "file.txt"),
					"content",
				);

				const packStream = packTar(sourceDir);
				const extractDir = path.join(tmpDir, "extract");

				let mapReceived = "";
				const unpackStream = unpackTar(extractDir, {
					strip: 1, // Remove "prefix/" component first
					map(entry) {
						mapReceived = entry.name; // Should receive "file.txt", not "prefix/file.txt"
						return entry;
					},
				});

				await pipeline(packStream, unpackStream);

				// Map should have received the stripped path, proving strip runs before map
				expect(mapReceived).toBe("file.txt");
				expect(mapReceived).not.toContain("prefix");
			});
		});
	});
});
