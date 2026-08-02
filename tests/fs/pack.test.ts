import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { describe, expect } from "vitest";
import { packTar, type TarSource, unpackTar } from "../../src/fs";
import { createTarDecoder, type TarHeader } from "../../src/web";
import { it } from "../helpers/test";
import { writeTree } from "../helpers/tree";

// Helper to get mtime in seconds, like in tar headers
const mtime = (stat: { mtime: Date }) =>
	Math.floor(stat.mtime.getTime() / 1000);

const readArchiveText = async (stream: AsyncIterable<Uint8Array>) => {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks).toString("utf8");
};

describe("pack", () => {
	it("packs and extracts a directory with a single file", async ({
		tmpDir,
	}) => {
		const sourceDir = await writeTree(path.join(tmpDir, "source"), {
			"hello.txt": "hello world\n",
		});
		const destDir = path.join(tmpDir, "extracted");

		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		const files = await fsp.readdir(destDir);
		expect(files).toHaveLength(1);
		expect(files[0]).toBe("hello.txt");

		const originalPath = path.join(sourceDir, "hello.txt");
		const copiedPath = path.join(destDir, "hello.txt");

		const originalContent = await fsp.readFile(originalPath, "utf-8");
		const copiedContent = await fsp.readFile(copiedPath, "utf-8");
		expect(copiedContent).toBe(originalContent);

		const originalStat = await fsp.stat(originalPath);
		const copiedStat = await fsp.stat(copiedPath);
		expect(copiedStat.mode).toBe(originalStat.mode);
		expect(mtime(copiedStat)).toBe(mtime(originalStat));
	});

	it("packs and extracts a nested directory", async ({ tmpDir }) => {
		const sourceDir = await writeTree(path.join(tmpDir, "source"), {
			"a/test.txt": "test\n",
		});
		const destDir = path.join(tmpDir, "extracted");

		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		const rootFiles = await fsp.readdir(destDir);
		expect(rootFiles).toEqual(["a"]);

		const nestedFiles = await fsp.readdir(path.join(destDir, "a"));
		expect(nestedFiles).toEqual(["test.txt"]);

		const originalPath = path.join(sourceDir, "a", "test.txt");
		const copiedPath = path.join(destDir, "a", "test.txt");

		const originalContent = await fsp.readFile(originalPath, "utf-8");
		const copiedContent = await fsp.readFile(copiedPath, "utf-8");
		expect(copiedContent).toBe(originalContent);
	});

	it("handles USTAR long filenames on a round trip", async ({ tmpDir }) => {
		const longDirName =
			"a-very-long-directory-name-that-is-over-100-characters-long";
		const nestedDirName =
			"and-needs-to-be-split-between-the-prefix-and-name-fields";
		const fileName = "file.txt";

		const sourceDir = path.join(tmpDir, "source");
		const longPath = path.join(sourceDir, longDirName, nestedDirName);
		const fullPath = path.join(longPath, fileName);

		await fsp.mkdir(longPath, { recursive: true });
		await fsp.writeFile(fullPath, "long path test");

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
		const content = await fsp.readFile(extractedFile, "utf-8");
		expect(content).toBe("long path test");
	});

	it("handles PAX long filenames on a round trip", async ({ tmpDir }) => {
		// This filename has a component longer than 100 chars and cannot use USTAR prefixing.
		const longFileName =
			"a-very-long-directory-name-that-is-well-over-one-hundred-characters-long-and-cannot-be-split-easily/file.txt";

		const sourceDir = path.join(tmpDir, "source");
		const longPathDir = path.join(sourceDir, path.dirname(longFileName));
		const fullPath = path.join(sourceDir, longFileName);

		await fsp.mkdir(longPathDir, { recursive: true });
		await fsp.writeFile(fullPath, "pax path test");

		const destDir = path.join(tmpDir, "extracted");
		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		const extractedFile = path.join(destDir, longFileName);
		const content = await fsp.readFile(extractedFile, "utf-8");
		expect(content).toBe("pax path test");
	});

	it("filters entries on pack", async ({ tmpDir }) => {
		const sourceDir = await writeTree(path.join(tmpDir, "source"), {
			".gitignore": "link\n",
		});
		const destDir = path.join(tmpDir, "extracted");

		const packStream = packTar(sourceDir, {
			filter: (filePath) => path.basename(filePath) !== ".gitignore",
		});
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		const files = await fsp.readdir(destDir);
		expect(files.includes(".gitignore")).toBe(false);
	});

	it("snapshots caller-provided source arrays and descriptors", async ({
		tmpDir,
	}) => {
		const sourceDir = path.join(tmpDir, "source");
		await fsp.mkdir(sourceDir);
		await fsp.writeFile(path.join(sourceDir, "child.txt"), "child");

		const safe = path.join(tmpDir, "safe.txt");
		const secret = path.join(tmpDir, "secret.txt");
		await fsp.writeFile(safe, "SAFE-DESCRIPTOR");
		await fsp.writeFile(secret, "SECRET-DESCRIPTOR");

		const sources: TarSource[] = [
			{ type: "directory", source: sourceDir, target: "source" },
			{ type: "file", source: safe, target: "safe.txt" },
		];

		let mutated = false;
		const archive = await readArchiveText(
			packTar(sources, {
				concurrency: 1,
				filter: (filePath) => {
					if (filePath === sourceDir && !mutated) {
						mutated = true;
						const pending = sources[1] as Extract<TarSource, { type: "file" }>;
						pending.source = secret;
						pending.target = "secret.txt";
					}

					return true;
				},
			}),
		);

		expect(mutated).toBe(true);
		expect(sources).toHaveLength(2);
		expect(archive).toContain("SAFE-DESCRIPTOR");
		expect(archive).not.toContain("SECRET-DESCRIPTOR");
	});

	it.skipIf(process.platform === "win32")(
		"skips files swapped after validation",
		async ({ tmpDir }) => {
			const emptyFile = path.join(tmpDir, "empty.txt");
			const file = path.join(tmpDir, "file.txt");
			const secret = path.join(tmpDir, "secret.txt");
			await fsp.writeFile(emptyFile, "");
			await fsp.writeFile(file, "SAFE12345678");
			await fsp.writeFile(secret, "LEAK12345678");

			const archive = await readArchiveText(
				packTar(
					[
						{ type: "file", source: emptyFile, target: "empty.txt" },
						{ type: "file", source: file, target: "file.txt" },
					],
					{
						concurrency: 1,
						filter: (filePath) => {
							fs.unlinkSync(filePath);
							fs.symlinkSync(secret, filePath);
							return true;
						},
					},
				),
			);

			expect(archive).not.toContain("LEAK12345678");
			expect(archive).not.toContain("empty.txt");
			expect(archive).not.toContain("file.txt");
		},
	);

	it("reads only the file size captured in its header", async ({ tmpDir }) => {
		const file = path.join(tmpDir, "file.txt");
		await fsp.writeFile(file, "SAFE");

		const destDir = path.join(tmpDir, "extracted");
		await pipeline(
			packTar([{ type: "file", source: file, target: "file.txt" }], {
				filter: () => {
					fs.appendFileSync(file, "CHANGED");
					return true;
				},
			}),
			unpackTar(destDir),
		);

		expect(await fsp.readFile(path.join(destDir, "file.txt"), "utf8")).toBe(
			"SAFE",
		);
	});

	it("handles partial reads from small files", async ({ tmpDir }) => {
		const file = path.join(tmpDir, "file.txt");
		await fsp.writeFile(file, "partial reads");

		const originalOpen = fsp.open;
		fs.promises.open = (async (...args: Parameters<typeof originalOpen>) => {
			const handle = await originalOpen(...args);
			const originalRead = handle.read.bind(handle);
			handle.read = ((
				buffer: Buffer,
				offset: number,
				length: number,
				position: number,
			) =>
				originalRead(
					buffer,
					offset,
					Math.min(length, 2),
					position,
				)) as typeof handle.read;
			return handle;
		}) as typeof originalOpen;
		syncBuiltinESMExports();

		const destDir = path.join(tmpDir, "extracted");
		try {
			await pipeline(
				packTar([{ type: "file", source: file, target: "file.txt" }]),
				unpackTar(destDir),
			);
		} finally {
			fs.promises.open = originalOpen;
			syncBuiltinESMExports();
		}

		expect(await fsp.readFile(path.join(destDir, "file.txt"), "utf8")).toBe(
			"partial reads",
		);
	});

	it("rejects small files truncated after their header is captured", async ({
		tmpDir,
	}) => {
		const file = path.join(tmpDir, "file.txt");
		await fsp.writeFile(file, "SAFE");

		await expect(
			readArchiveText(
				packTar([{ type: "file", source: file, target: "file.txt" }], {
					filter: () => {
						fs.truncateSync(file, 2);
						return true;
					},
				}),
			),
		).rejects.toThrow('Size mismatch for "file.txt".');
	});

	it.skipIf(process.platform === "win32")(
		"does not follow dereferenced symlink swaps outside the base",
		async ({ tmpDir }) => {
			const sourceDir = path.join(tmpDir, "source");
			await fsp.mkdir(sourceDir);

			const target = path.join(sourceDir, "target.txt");
			const link = path.join(sourceDir, "link.txt");
			const secret = path.join(tmpDir, "secret.txt");

			await fsp.writeFile(target, "SAFE12345678");
			await fsp.writeFile(secret, "LEAK12345678");
			await fsp.symlink("target.txt", link);

			let swapped = false;
			const archive = await readArchiveText(
				packTar([{ type: "file", source: link, target: "link.txt" }], {
					baseDir: sourceDir,
					concurrency: 1,
					dereference: true,
					filter: (filePath) => {
						if (filePath === link && !swapped) {
							swapped = true;
							fs.unlinkSync(link);
							fs.symlinkSync(secret, link);
						}

						return true;
					},
				}),
			);

			expect(swapped).toBe(true);
			expect(archive).not.toContain("LEAK12345678");
		},
	);

	it.skipIf(process.platform === "win32")(
		"skips dereferenced symlinks with final targets outside the base",
		async ({ tmpDir }) => {
			const sourceDir = path.join(tmpDir, "source");
			await fsp.mkdir(sourceDir);

			const inner = path.join(sourceDir, "inner.txt");
			const outer = path.join(sourceDir, "outer.txt");
			const secret = path.join(tmpDir, "secret.txt");

			await fsp.writeFile(secret, "CHAIN-LEAK!");
			await fsp.symlink(secret, inner);
			await fsp.symlink("inner.txt", outer);

			const archive = await readArchiveText(
				packTar([{ type: "file", source: outer, target: "outer.txt" }], {
					baseDir: sourceDir,
					concurrency: 1,
					dereference: true,
				}),
			);

			expect(archive).not.toContain("CHAIN-LEAK!");
			expect(archive).not.toContain("outer.txt");
		},
	);

	it.skipIf(process.platform === "win32")(
		"allows dereferenced targets with dot-prefixed names inside the base",
		async ({ tmpDir }) => {
			const sourceDir = path.join(tmpDir, "source");
			await fsp.mkdir(sourceDir);

			const target = path.join(sourceDir, "..safe.txt");
			const link = path.join(sourceDir, "link.txt");

			await fsp.writeFile(target, "SAFE-DOT-TARGET");
			await fsp.symlink("..safe.txt", link);

			const archive = await readArchiveText(
				packTar([{ type: "file", source: link, target: "link.txt" }], {
					baseDir: sourceDir,
					dereference: true,
				}),
			);

			expect(archive).toContain("SAFE-DOT-TARGET");
			expect(archive).toContain("link.txt");
		},
	);

	it.skipIf(process.platform === "win32")(
		"skips directories swapped after validation",
		async ({ tmpDir }) => {
			const sourceDir = path.join(tmpDir, "source");
			const childDir = path.join(sourceDir, "child");
			const outsideDir = path.join(tmpDir, "outside");

			await fsp.mkdir(childDir, { recursive: true });
			await fsp.mkdir(outsideDir);
			await fsp.writeFile(path.join(outsideDir, "secret.txt"), "DIR-LEAK!");

			let swapped = false;
			const archive = await readArchiveText(
				packTar(sourceDir, {
					concurrency: 1,
					filter: (filePath) => {
						if (filePath === childDir && !swapped) {
							swapped = true;
							fs.rmSync(childDir, { recursive: true, force: true });
							fs.symlinkSync(outsideDir, childDir);
						}

						return true;
					},
				}),
			);

			expect(swapped).toBe(true);
			expect(archive).not.toContain("DIR-LEAK!");
			expect(archive).not.toContain("secret.txt");
		},
	);

	it.skipIf(process.platform === "win32")(
		"skips entries enumerated through a swapped directory",
		async ({ tmpDir }) => {
			const sourceDir = path.join(tmpDir, "source");
			const childDir = path.join(sourceDir, "child");
			const outsideDir = path.join(tmpDir, "outside");

			await fsp.mkdir(childDir, { recursive: true });
			await fsp.mkdir(outsideDir);
			await fsp.writeFile(path.join(outsideDir, "secret.txt"), "DIR-LEAK!");

			const originalReaddir = fsp.readdir;
			let swapped = false;
			fs.promises.readdir = (async (
				...args: Parameters<typeof originalReaddir>
			) => {
				if (args[0] === childDir && !swapped) {
					swapped = true;
					fs.rmSync(childDir, { recursive: true, force: true });
					fs.symlinkSync(outsideDir, childDir);
				}

				return originalReaddir(...args);
			}) as typeof originalReaddir;
			syncBuiltinESMExports();

			let archive: string;
			try {
				archive = await readArchiveText(packTar(sourceDir, { concurrency: 1 }));
			} finally {
				fs.promises.readdir = originalReaddir;
				syncBuiltinESMExports();
			}

			expect(swapped).toBe(true);
			expect(archive).not.toContain("DIR-LEAK!");
			expect(archive).not.toContain("secret.txt");
		},
	);

	it("handles empty files", async ({ tmpDir }) => {
		const sourceDir = path.join(tmpDir, "source");
		await fsp.mkdir(sourceDir, { recursive: true });

		// Create an empty file
		const emptyFilePath = path.join(sourceDir, "empty.txt");
		await fsp.writeFile(emptyFilePath, "");

		const destDir = path.join(tmpDir, "extracted");
		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		// Verify the extracted file
		const extractedPath = path.join(destDir, "empty.txt");
		const extractedContent = await fsp.readFile(extractedPath);
		expect(extractedContent).toEqual(Buffer.alloc(0));

		const stats = await fsp.stat(extractedPath);
		expect(stats.size).toBe(0);
	});

	it("handles various file sizes correctly", async ({ tmpDir }) => {
		const sourceDir = path.join(tmpDir, "source");
		await fsp.mkdir(sourceDir, { recursive: true });

		// Create files of different sizes to test both small and large file handling
		const files = [
			{ name: "tiny.txt", size: 512 }, // Small
			{ name: "small.txt", size: 16 * 1024 }, // Small (16KB)
			{ name: "threshold.txt", size: 32 * 1024 }, // At 32KB threshold
			{ name: "large.bin", size: 128 * 1024 }, // Large (128KB)
		];

		// Create all test files
		for (const file of files) {
			const content = Buffer.alloc(file.size, file.name[0]);
			await fsp.writeFile(path.join(sourceDir, file.name), content);
		}

		const destDir = path.join(tmpDir, "extracted");
		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		// Verify all files were extracted correctly
		for (const file of files) {
			const extractedPath = path.join(destDir, file.name);
			const extractedContent = await fsp.readFile(extractedPath);
			const expectedContent = Buffer.alloc(file.size, file.name[0]);

			expect(extractedContent).toEqual(expectedContent);

			const stats = await fsp.stat(extractedPath);
			expect(stats.size).toBe(file.size);
		}
	});

	it("allows overriding file and directory modes", async ({ tmpDir }) => {
		// Create test files with specific permissions
		const testFile = path.join(tmpDir, "test.txt");
		const testDir = path.join(tmpDir, "testdir");

		await fsp.writeFile(testFile, "test content");
		await fsp.mkdir(testDir);
		await fsp.writeFile(path.join(testDir, "nested.txt"), "nested content");

		// Set specific permissions (only on Unix systems)
		if (process.platform !== "win32") {
			await fsp.chmod(testFile, 0o600); // rw-------
			await fsp.chmod(testDir, 0o700); // rwx------
		}

		// Pack with mode overrides
		const sources = [
			{
				type: "file" as const,
				source: testFile,
				target: "override.txt",
				mode: 0o644,
			},
			{
				type: "directory" as const,
				source: testDir,
				target: "overridedir",
				mode: 0o755,
			},
		];

		const destDir = path.join(tmpDir, "extracted");
		const packStream = packTar(sources);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		// Check that extracted files have the overridden modes
		const extractedFile = path.join(destDir, "override.txt");
		const extractedDir = path.join(destDir, "overridedir");

		const fileStat = await fsp.stat(extractedFile);
		const dirStat = await fsp.stat(extractedDir);

		// Mask to get only permission bits (remove file type bits)
		const fileMode = fileStat.mode & 0o777;
		const dirMode = dirStat.mode & 0o777;

		if (process.platform === "win32") {
			// On Windows, expect 0o666 for files due to Windows permission handling
			expect(fileMode).toBe(0o666);
			expect(dirStat.isDirectory()).toBe(true); // Verify it's a directory
		} else {
			// On Unix systems, expect the exact overridden modes
			expect(fileMode).toBe(0o644); // Should be overridden mode, not 0o600
			expect(dirMode).toBe(0o755); // Should be overridden mode, not 0o700
		}

		// Verify content is still correct (all platforms)
		const content = await fsp.readFile(extractedFile, "utf-8");
		expect(content).toBe("test content");

		const nestedContent = await fsp.readFile(
			path.join(extractedDir, "nested.txt"),
			"utf-8",
		);
		expect(nestedContent).toBe("nested content");
	});

	it("allows overriding all metadata properties for all source types", async ({
		tmpDir,
	}) => {
		// Create test files
		const testFile = path.join(tmpDir, "test.txt");
		const testDir = path.join(tmpDir, "testdir");

		await fsp.writeFile(testFile, "test content");
		await fsp.mkdir(testDir);
		await fsp.writeFile(path.join(testDir, "nested.txt"), "nested content");

		// Custom metadata values
		const customMtime = new Date("2023-01-15T12:00:00Z");
		const customUid = 1001;
		const customGid = 1002;
		const customUname = "testuser";
		const customGname = "testgroup";
		const customFileMode = 0o755;
		const customDirMode = 0o700;

		const sources = [
			{
				type: "file" as const,
				source: testFile,
				target: "overridden-file.txt",
				mtime: customMtime,
				uid: customUid,
				gid: customGid,
				uname: customUname,
				gname: customGname,
				mode: customFileMode,
			},
			{
				type: "directory" as const,
				source: testDir,
				target: "overridden-dir",
				mtime: customMtime,
				uid: customUid,
				gid: customGid,
				uname: customUname,
				gname: customGname,
				mode: customDirMode,
			},
			{
				type: "content" as const,
				content: "content source data",
				target: "content-file.txt",
				mtime: customMtime,
				uid: customUid,
				gid: customGid,
				uname: customUname,
				gname: customGname,
				mode: customFileMode,
			},
		];

		// Extract the tar and verify metadata
		const destDir = path.join(tmpDir, "metadata-test");
		const packStream = packTar(sources);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		// Verify extracted file metadata
		const extractedFile = path.join(destDir, "overridden-file.txt");
		const extractedDir = path.join(destDir, "overridden-dir");
		const extractedContent = path.join(destDir, "content-file.txt");

		const fileStat = await fsp.stat(extractedFile);
		const dirStat = await fsp.stat(extractedDir);
		const contentStat = await fsp.stat(extractedContent);

		// Check modes (mask to get only permission bits)
		if (process.platform === "win32") {
			// On Windows, expect 0o666 for files due to Windows permission handling
			expect(fileStat.mode & 0o777).toBe(0o666);
			expect(contentStat.mode & 0o777).toBe(0o666);
			expect(dirStat.isDirectory()).toBe(true);
		} else {
			// On Unix systems, expect the exact overridden modes
			expect(fileStat.mode & 0o777).toBe(customFileMode);
			expect(dirStat.mode & 0o777).toBe(customDirMode);
			expect(contentStat.mode & 0o777).toBe(customFileMode);
		}

		// Check modification times (within 1 second tolerance for filesystem precision)
		const timeDiff = Math.abs(fileStat.mtime.getTime() - customMtime.getTime());
		expect(timeDiff).toBeLessThan(1000);

		// Verify content integrity
		const fileContent = await fsp.readFile(extractedFile, "utf-8");
		const contentFileContent = await fsp.readFile(extractedContent, "utf-8");
		const nestedFileContent = await fsp.readFile(
			path.join(extractedDir, "nested.txt"),
			"utf-8",
		);

		expect(fileContent).toBe("test content");
		expect(contentFileContent).toBe("content source data");
		expect(nestedFileContent).toBe("nested content");
	});

	it("uses safe defaults for uid and gid in ContentSource and StreamSource", async ({
		tmpDir,
	}) => {
		const sources = [
			{
				type: "content" as const,
				content: "test content",
				target: "default-content.txt",
			},
		];

		const destDir = path.join(tmpDir, "defaults-test");
		const packStream = packTar(sources);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		const extractedFile = path.join(destDir, "default-content.txt");
		const stat = await fsp.stat(extractedFile);

		// Verify content and that it was created successfully with safe defaults
		const content = await fsp.readFile(extractedFile, "utf-8");
		expect(content).toBe("test content");
		expect(stat.size).toBe(12); // "test content".length
	});

	it("allows partial metadata overrides while preserving filesystem values", async ({
		tmpDir,
	}) => {
		const testFile = path.join(tmpDir, "partial.txt");
		await fsp.writeFile(testFile, "partial override test");

		// Get original filesystem metadata
		const originalStat = await fsp.stat(testFile);

		const sources = [
			{
				type: "file" as const,
				source: testFile,
				target: "partial-override.txt",
				// Only override uid and uname, leave other metadata from filesystem
				uid: 9999,
				uname: "customuser",
			},
		];

		const destDir = path.join(tmpDir, "partial-test");
		const packStream = packTar(sources);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		const extractedFile = path.join(destDir, "partial-override.txt");
		const extractedStat = await fsp.stat(extractedFile);

		// Verify content
		const content = await fsp.readFile(extractedFile, "utf-8");
		expect(content).toBe("partial override test");

		// Mode should be preserved from filesystem (masked to permission bits)
		if (process.platform === "win32") {
			// On Windows, expect 0o666 for files
			expect(extractedStat.mode & 0o777).toBe(0o666);
		} else {
			// On Unix systems, expect the original filesystem mode
			expect(extractedStat.mode & 0o777).toBe(originalStat.mode & 0o777);
		}

		// Modification time should be preserved (within tolerance)
		const timeDiff = Math.abs(
			extractedStat.mtime.getTime() - originalStat.mtime.getTime(),
		);
		expect(timeDiff).toBeLessThan(1000);
	});

	it("correctly applies default directory mode for ContentSource directory entries", async () => {
		// This test reproduces a bug where ContentSource entries with directory paths
		// incorrectly get file mode (0o644) instead of directory mode (0o755)
		const sources = [
			{
				type: "content" as const,
				content: null, // Directory entries have null content
				target: "test-directory/", // Directory path (ends with /)
				// Intentionally not specifying mode to test default behavior
			},
			{
				type: "content" as const,
				content: "file content",
				target: "test-file.txt", // File path (no trailing /)
				// Intentionally not specifying mode to test default behavior
			},
		];

		// Create a tar stream and examine the raw headers
		const packStream = packTar(sources);
		const decoder = createTarDecoder();
		const entries: { header: TarHeader; body: ReadableStream }[] = [];

		// Convert Node.js Readable to Web ReadableStream
		const webStream = new ReadableStream({
			start(controller) {
				packStream.on("data", (chunk) => {
					controller.enqueue(new Uint8Array(chunk));
				});
				packStream.on("end", () => {
					controller.close();
				});
				packStream.on("error", (err) => {
					controller.error(err);
				});
			},
		});

		// Parse the tar stream to get headers
		const entryStream = webStream.pipeThrough(decoder);
		const reader = entryStream.getReader();

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				entries.push(value);
				// Consume the body stream to continue reading
				const bodyReader = value.body.getReader();
				while (true) {
					const { done: bodyDone } = await bodyReader.read();
					if (bodyDone) break;
				}
			}
		} finally {
			reader.releaseLock();
		}

		// Verify we have the expected entries
		expect(entries).toHaveLength(2);

		// Find directory and file entries
		const dirEntry = entries.find((e) => e.header.name === "test-directory/");
		const fileEntry = entries.find((e) => e.header.name === "test-file.txt");

		expect(dirEntry).toBeDefined();
		expect(fileEntry).toBeDefined();

		// Verify types
		expect(dirEntry?.header.type).toBe("directory");
		expect(fileEntry?.header.type).toBe("file");

		// The bug: directory should have mode 0o755 (DEFAULT_DIR_MODE), not 0o644 (DEFAULT_FILE_MODE)
		// This test currently FAILS due to the bug, but will pass after the fix
		expect(dirEntry?.header.mode).toBe(0o755); // Should be directory default mode
		expect(fileEntry?.header.mode).toBe(0o644); // Should be file default mode
	});

	it("correctly applies default directory mode for StreamSource directory entries", async () => {
		// Test that StreamSource can also create directory entries with correct modes
		const sources = [
			{
				type: "stream" as const,
				content: new ReadableStream({
					start(controller) {
						controller.close(); // Empty stream for directory
					},
				}),
				size: 0, // Directory size is 0
				target: "stream-directory/", // Directory path (ends with /)
				// Intentionally not specifying mode to test default behavior
			},
			{
				type: "stream" as const,
				content: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("stream file content"));
						controller.close();
					},
				}),
				size: 19, // Length of "stream file content"
				target: "stream-file.txt", // File path (no trailing /)
				// Intentionally not specifying mode to test default behavior
			},
		];

		// Create a tar stream and examine the raw headers
		const packStream = packTar(sources);
		const decoder = createTarDecoder();
		const entries: { header: TarHeader; body: ReadableStream }[] = [];

		// Convert Node.js Readable to Web ReadableStream
		const webStream = new ReadableStream({
			start(controller) {
				packStream.on("data", (chunk) => {
					controller.enqueue(new Uint8Array(chunk));
				});
				packStream.on("end", () => {
					controller.close();
				});
				packStream.on("error", (err) => {
					controller.error(err);
				});
			},
		});

		// Parse the tar stream to get headers
		const entryStream = webStream.pipeThrough(decoder);
		const reader = entryStream.getReader();

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				entries.push(value);
				// Consume the body stream to continue reading
				const bodyReader = value.body.getReader();
				while (true) {
					const { done: bodyDone } = await bodyReader.read();
					if (bodyDone) break;
				}
			}
		} finally {
			reader.releaseLock();
		}

		// Verify we have the expected entries
		expect(entries).toHaveLength(2);

		// Find directory and file entries
		const dirEntry = entries.find((e) => e.header.name === "stream-directory/");
		const fileEntry = entries.find((e) => e.header.name === "stream-file.txt");

		expect(dirEntry).toBeDefined();
		expect(fileEntry).toBeDefined();

		// Verify types
		expect(dirEntry?.header.type).toBe("directory");
		expect(fileEntry?.header.type).toBe("file");

		// Verify correct default modes are applied
		expect(dirEntry?.header.mode).toBe(0o755); // Should be directory default mode
		expect(fileEntry?.header.mode).toBe(0o644); // Should be file default mode

		// Verify sizes
		expect(dirEntry?.header.size).toBe(0); // Directories have size 0
		expect(fileEntry?.header.size).toBe(19); // File should have content size
	});

	it("allows explicit mode override for ContentSource and StreamSource directories", async () => {
		// Test that explicit mode values are respected even for directories
		const customDirMode = 0o700;
		const customFileMode = 0o600;

		const sources = [
			{
				type: "content" as const,
				content: null,
				target: "custom-dir/",
				mode: customDirMode, // Explicit directory mode override
			},
			{
				type: "stream" as const,
				content: new ReadableStream({
					start(controller) {
						controller.close();
					},
				}),
				size: 0,
				target: "custom-stream-dir/",
				mode: customDirMode, // Explicit directory mode override
			},
			{
				type: "content" as const,
				content: "test content",
				target: "custom-file.txt",
				mode: customFileMode, // Explicit file mode override
			},
		];

		// Create a tar stream and examine the raw headers
		const packStream = packTar(sources);
		const decoder = createTarDecoder();
		const entries: { header: TarHeader; body: ReadableStream }[] = [];

		// Convert Node.js Readable to Web ReadableStream
		const webStream = new ReadableStream({
			start(controller) {
				packStream.on("data", (chunk) => {
					controller.enqueue(new Uint8Array(chunk));
				});
				packStream.on("end", () => {
					controller.close();
				});
				packStream.on("error", (err) => {
					controller.error(err);
				});
			},
		});

		// Parse the tar stream to get headers
		const entryStream = webStream.pipeThrough(decoder);
		const reader = entryStream.getReader();

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				entries.push(value);
				// Consume the body stream to continue reading
				const bodyReader = value.body.getReader();
				while (true) {
					const { done: bodyDone } = await bodyReader.read();
					if (bodyDone) break;
				}
			}
		} finally {
			reader.releaseLock();
		}

		// Verify we have the expected entries
		expect(entries).toHaveLength(3);

		// Find entries
		const contentDirEntry = entries.find(
			(e) => e.header.name === "custom-dir/",
		);
		const streamDirEntry = entries.find(
			(e) => e.header.name === "custom-stream-dir/",
		);
		const fileEntry = entries.find((e) => e.header.name === "custom-file.txt");

		expect(contentDirEntry).toBeDefined();
		expect(streamDirEntry).toBeDefined();
		expect(fileEntry).toBeDefined();

		// Verify types
		expect(contentDirEntry?.header.type).toBe("directory");
		expect(streamDirEntry?.header.type).toBe("directory");
		expect(fileEntry?.header.type).toBe("file");

		// Verify explicit modes are respected
		expect(contentDirEntry?.header.mode).toBe(customDirMode);
		expect(streamDirEntry?.header.mode).toBe(customDirMode);
		expect(fileEntry?.header.mode).toBe(customFileMode);
	});

	it("strips absolute paths during packing", async ({ tmpDir }) => {
		const sources = [
			{
				type: "content" as const,
				content: "file with absolute path",
				target: "/tmp/absolute-file.txt",
			},
			{
				type: "content" as const,
				content: null,
				target: "/absolute/directory/",
			},
			{
				type: "content" as const,
				content: "windows absolute path",
				target: "C:/windows/file.txt",
			},
		];

		const tarStream = packTar(sources);
		const destDir = path.join(tmpDir, "extracted");

		await pipeline(tarStream, unpackTar(destDir));

		// Verify files are extracted with stripped absolute paths
		const absoluteFile = path.join(destDir, "tmp", "absolute-file.txt");
		const absoluteDir = path.join(destDir, "absolute", "directory");
		const windowsFile = path.join(destDir, "windows", "file.txt");

		expect(await fsp.readFile(absoluteFile, "utf8")).toBe(
			"file with absolute path",
		);
		expect((await fsp.stat(absoluteDir)).isDirectory()).toBe(true);
		expect(await fsp.readFile(windowsFile, "utf8")).toBe(
			"windows absolute path",
		);
	});
});
