import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fs/promises to introduce delay in mkdir for specific test case.
const originalFs =
	await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let mkdirDelay: Promise<void> | null = null;
let releaseMkdir: (() => void) | null = null;

vi.mock("node:fs/promises", async () => {
	const actual =
		await vi.importActual<typeof import("node:fs/promises")>(
			"node:fs/promises",
		);
	return {
		...actual,
		mkdir: vi
			.fn()
			.mockImplementation(
				async (
					target: string,
					options?: Parameters<typeof actual.mkdir>[1],
				) => {
					if (
						mkdirDelay &&
						typeof target === "string" &&
						target.includes("delayed-extracted")
					) {
						await mkdirDelay;
					}
					return actual.mkdir(target, options);
				},
			),
	};
});

import * as fs from "node:fs/promises";
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

	it("waits for destination directory creation when all entries are filtered", async () => {
		const destDir = path.join(tmpDir, "delayed-extracted");

		// Set up the delay for mkdir
		mkdirDelay = new Promise<void>((resolve) => {
			releaseMkdir = resolve;
		});

		try {
			const entries = [
				{
					header: {
						name: "ignored.txt",
						size: 0,
						type: "file" as const,
					},
				},
			];

			const tarBuffer = await packTarWeb(entries);
			const packStream = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(destDir, { filter: () => false });

			const pipelinePromise = pipeline(packStream, unpackStream);

			// Test that pipeline doesn't complete immediately due to race condition
			const result = await Promise.race([
				pipelinePromise.then(() => "finished"),
				new Promise<string>((resolve) =>
					setTimeout(() => resolve("timeout"), 200),
				),
			]);

			expect(result).toBe("timeout");

			// Release the mkdir and let the pipeline complete
			releaseMkdir?.();
			await pipelinePromise;

			// Verify the destination directory was created and no files were extracted
			await expect(originalFs.readdir(destDir)).resolves.toEqual([]);
		} finally {
			mkdirDelay = null;
			releaseMkdir = null;
		}
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

	it("handles directory mode override", async () => {
		const destDir = path.join(tmpDir, "extracted");

		const entries = [
			{
				header: {
					name: "testdir",
					size: 0,
					type: "directory" as const,
					mode: 0o700,
				},
			},
		];

		const tarBuffer = await packTarWeb(entries);
		const unpackStream = unpackTar(destDir, {
			dmode: 0o755, // Override directory mode
		});

		await pipeline(Readable.from([tarBuffer]), unpackStream);

		const dirPath = path.join(destDir, "testdir");
		const stats = await fs.stat(dirPath);

		// Check that directory mode override was applied
		if (process.platform === "win32") {
			// On Windows, file permissions work differently - just check it's a directory
			expect(stats.isDirectory()).toBe(true);
		} else {
			expect(stats.mode & 0o777).toBe(0o755);
		}
	});

	it("handles symlink validation with cache invalidation", async () => {
		const destDir = path.join(tmpDir, "extracted");

		// First create a directory, then replace it with a symlink
		const entries = [
			{
				header: {
					name: "testdir",
					size: 0,
					type: "directory" as const,
					mode: 0o755,
				},
			},
			{
				header: {
					name: "testsymlink",
					size: 0,
					type: "symlink" as const,
					linkname: "testdir", // Safe symlink within extraction directory
				},
			},
		];

		const tarBuffer = await packTarWeb(entries);
		const unpackStream = unpackTar(destDir);

		// This should handle cache invalidation properly
		await pipeline(Readable.from([tarBuffer]), unpackStream);

		// Verify both directory and symlink were created
		const dirStats = await fs.lstat(path.join(destDir, "testdir"));
		expect(dirStats.isDirectory()).toBe(true);

		const linkStats = await fs.lstat(path.join(destDir, "testsymlink"));
		expect(linkStats.isSymbolicLink()).toBe(true);

		const linkTarget = await fs.readlink(path.join(destDir, "testsymlink"));
		expect(linkTarget).toBe("testdir");
	});

	it("handles file permissions and timestamps correctly", async () => {
		const destDir = path.join(tmpDir, "extracted");
		const testTime = new Date("2020-01-01T12:00:00Z");

		const entries = [
			{
				header: {
					name: "test-file.txt",
					size: 12,
					type: "file" as const,
					mode: 0o600, // Specific permissions
					mtime: testTime,
				},
				body: "hello world\n",
			},
		];

		const tarBuffer = await packTarWeb(entries);
		const unpackStream = unpackTar(destDir, {
			fmode: 0o644, // Override file mode
		});

		await pipeline(Readable.from([tarBuffer]), unpackStream);

		const filePath = path.join(destDir, "test-file.txt");
		const stats = await fs.stat(filePath);

		// Check that file mode override was applied
		if (process.platform === "win32") {
			// On Windows, file permissions work differently - just check it's a file
			expect(stats.isFile()).toBe(true);
		} else {
			expect(stats.mode & 0o777).toBe(0o644);
		}

		const content = await fs.readFile(filePath, "utf8");
		expect(content).toBe("hello world\n");
	});

	it("handles maxDepth validation", async () => {
		const destDir = path.join(tmpDir, "extracted");

		const entries = [
			{
				header: {
					name: "a/very/deep/nested/path/that/exceeds/max/depth.txt",
					size: 12,
					type: "file" as const,
					mode: 0o644,
				},
				body: "hello world\n",
			},
		];

		const tarBuffer = await packTarWeb(entries);
		const unpackStream = unpackTar(destDir, { maxDepth: 3 });

		await expect(
			pipeline(Readable.from([tarBuffer]), unpackStream),
		).rejects.toThrow("Tar exceeds max specified depth.");
	});

	it("strips absolute paths in entries", async () => {
		const destDir = path.join(tmpDir, "extracted");

		const entries = [
			{
				header: {
					name: "/absolute/path.txt",
					size: 12,
					type: "file" as const,
					mode: 0o644,
				},
				body: "hello world\n",
			},
		];

		const tarBuffer = await packTarWeb(entries);
		const unpackStream = unpackTar(destDir);

		// Should succeed by stripping the absolute path prefix
		await expect(
			pipeline(Readable.from([tarBuffer]), unpackStream),
		).resolves.toBeUndefined();

		// File should be extracted with stripped path: absolute/path.txt
		const filePath = path.join(destDir, "absolute", "path.txt");
		const fileContent = await fs.readFile(filePath, "utf8");
		expect(fileContent).toBe("hello world\n");
	});

	it("handles hardlink with absolute target", async () => {
		const destDir = path.join(tmpDir, "extracted");

		const entries = [
			{
				header: {
					name: "hardlink",
					size: 0,
					type: "link" as const,
					linkname: "/absolute/target",
				},
			},
		];

		const tarBuffer = await packTarWeb(entries);
		const unpackStream = unpackTar(destDir);

		await expect(
			pipeline(Readable.from([tarBuffer]), unpackStream),
		).rejects.toThrow(
			'Hardlink "/absolute/target" points outside the extraction directory.',
		);
	});

	it("handles timestamps on symlinks", async () => {
		const destDir = path.join(tmpDir, "extracted");
		const testTime = new Date("2020-01-01T00:00:00Z");

		const entries = [
			{
				header: {
					name: "test-symlink",
					size: 0,
					type: "symlink" as const,
					linkname: "target",
					mtime: testTime,
				},
			},
		];

		const tarBuffer = await packTarWeb(entries);
		const unpackStream = unpackTar(destDir);

		await pipeline(Readable.from([tarBuffer]), unpackStream);

		// Verify the symlink was created (timestamp setting is best-effort)
		const linkPath = path.join(destDir, "test-symlink");
		const linkTarget = await fs.readlink(linkPath);
		expect(linkTarget).toBe("target");
	});

	it("handles multiple files with different mtimes", async () => {
		const destDir = path.join(tmpDir, "extracted");
		const mtime1 = new Date("2023-01-01T00:00:00Z");
		const mtime2 = new Date("2023-06-15T12:00:00Z");
		const mtime3 = new Date("2023-12-31T23:59:59Z");

		const entries = [
			{
				header: {
					name: "file1.txt",
					size: 6,
					type: "file" as const,
					mode: 0o644,
					mtime: mtime1,
				},
				body: "file 1",
			},
			{
				header: {
					name: "file2.txt",
					size: 6,
					type: "file" as const,
					mode: 0o644,
					mtime: mtime2,
				},
				body: "file 2",
			},
			{
				header: {
					name: "file3.txt",
					size: 6,
					type: "file" as const,
					mode: 0o644,
					mtime: mtime3,
				},
				body: "file 3",
			},
		];

		const tarBuffer = await packTarWeb(entries);
		const unpackStream = unpackTar(destDir);
		await pipeline(Readable.from([tarBuffer]), unpackStream);

		// Verify each file has correct mtime
		const file1Stats = await fs.stat(path.join(destDir, "file1.txt"));
		const file2Stats = await fs.stat(path.join(destDir, "file2.txt"));
		const file3Stats = await fs.stat(path.join(destDir, "file3.txt"));

		expect(file1Stats.mtime.getTime()).toBe(mtime1.getTime());
		expect(file2Stats.mtime.getTime()).toBe(mtime2.getTime());
		expect(file3Stats.mtime.getTime()).toBe(mtime3.getTime());
	});

	it("handles empty files with mtime", async () => {
		const destDir = path.join(tmpDir, "extracted");
		const testMtime = new Date("2023-07-20T10:15:30Z");

		const entries = [
			{
				header: {
					name: "empty-file.txt",
					size: 0,
					type: "file" as const,
					mode: 0o644,
					mtime: testMtime,
				},
				body: "",
			},
		];

		const tarBuffer = await packTarWeb(entries);
		const unpackStream = unpackTar(destDir);
		await pipeline(Readable.from([tarBuffer]), unpackStream);

		// Verify empty file has correct mtime
		const extractedPath = path.join(destDir, "empty-file.txt");
		const stats = await fs.stat(extractedPath);
		expect(stats.mtime.getTime()).toBe(testMtime.getTime());
		expect(stats.size).toBe(0);
	});

	it("handles files with very old and very new timestamps", async () => {
		const destDir = path.join(tmpDir, "extracted");
		const oldMtime = new Date("1990-01-01T00:00:00Z");
		const newMtime = new Date("2030-12-31T23:59:59Z");

		const entries = [
			{
				header: {
					name: "old-file.txt",
					size: 8,
					type: "file" as const,
					mode: 0o644,
					mtime: oldMtime,
				},
				body: "old file",
			},
			{
				header: {
					name: "new-file.txt",
					size: 8,
					type: "file" as const,
					mode: 0o644,
					mtime: newMtime,
				},
				body: "new file",
			},
		];

		const tarBuffer = await packTarWeb(entries);
		const unpackStream = unpackTar(destDir);
		await pipeline(Readable.from([tarBuffer]), unpackStream);

		// Verify timestamps
		const oldStats = await fs.stat(path.join(destDir, "old-file.txt"));
		const newStats = await fs.stat(path.join(destDir, "new-file.txt"));

		expect(oldStats.mtime.getTime()).toBe(oldMtime.getTime());
		expect(newStats.mtime.getTime()).toBe(newMtime.getTime());
	});

	it("handles nested directories with file mtimes", async () => {
		const destDir = path.join(tmpDir, "extracted");
		const dirMtime = new Date("2023-05-01T12:00:00Z");
		const fileMtime = new Date("2023-05-02T14:30:00Z");

		const entries = [
			{
				header: {
					name: "nested/",
					size: 0,
					type: "directory" as const,
					mode: 0o755,
					mtime: dirMtime,
				},
			},
			{
				header: {
					name: "nested/deep-file.txt",
					size: 9,
					type: "file" as const,
					mode: 0o644,
					mtime: fileMtime,
				},
				body: "deep file",
			},
		];

		const tarBuffer = await packTarWeb(entries);
		const unpackStream = unpackTar(destDir);
		await pipeline(Readable.from([tarBuffer]), unpackStream);

		// Verify nested file has correct mtime
		const fileStats = await fs.stat(
			path.join(destDir, "nested", "deep-file.txt"),
		);
		expect(fileStats.mtime.getTime()).toBe(fileMtime.getTime());

		// Verify content
		const content = await fs.readFile(
			path.join(destDir, "nested", "deep-file.txt"),
			"utf8",
		);
		expect(content).toBe("deep file");
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

	it("handles errors during processing", async () => {
		const destDir = path.join(tmpDir, "extracted");

		// Create a tar with an invalid symlink that will cause an error
		const entries = [
			{
				header: {
					name: "bad-symlink",
					size: 0,
					type: "symlink" as const,
					linkname: "../../../escape-attempt",
				},
			},
		];

		const tarBuffer = await packTarWeb(entries);
		const unpackStream = unpackTar(destDir);

		// This should trigger the processingPromise.catch block due to path validation
		await expect(
			pipeline(Readable.from([tarBuffer]), unpackStream),
		).rejects.toThrow(
			'Symlink "../../../escape-attempt" points outside the extraction directory.',
		);
	});

	describe("edge cases", () => {
		it("handles validate path with non-directory/non-symlink file blocking path", async () => {
			const destDir = path.join(tmpDir, "extracted");
			await fs.mkdir(destDir, { recursive: true });

			// Create a regular file where we need a directory
			const blockingFile = path.join(destDir, "blocking");
			await fs.writeFile(blockingFile, "content");

			const entries = [
				{
					header: {
						name: "blocking/file.txt",
						size: 12,
						type: "file" as const,
						mode: 0o644,
					},
					body: "hello world\n",
				},
			];

			const tarBuffer = await packTarWeb(entries);
			const unpackStream = unpackTar(destDir);

			await expect(
				pipeline(Readable.from([tarBuffer]), unpackStream),
			).rejects.toThrow("is not a valid directory component");
		});
	});

	describe("malformed archive handling", () => {
		it("should correctly unpack a file entry with erroneous trailing slashes", async () => {
			const destDir = path.join(tmpDir, "extracted");

			// Arrange: Create an archive where a file entry's path incorrectly ends with a slash.
			const entries = [
				{
					header: {
						name: "my-file.txt/", // Malformed path for a file
						type: "file" as const,
						size: 7,
						mode: 0o644,
						mtime: new Date(),
					},
					body: "content",
				},
			];

			const tarBuffer = await packTarWeb(entries);
			const tarStream = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(destDir);

			await pipeline(tarStream, unpackStream);

			const createdPath = path.join(destDir, "my-file.txt");

			const stats = await fs.stat(createdPath);
			expect(stats.isFile()).toBe(true);
			expect(stats.isDirectory()).toBe(false);

			const content = await fs.readFile(createdPath, "utf-8");
			expect(content).toBe("content");
		});

		it("should handle multiple trailing slashes on files", async () => {
			const destDir = path.join(tmpDir, "extracted");

			const entries = [
				{
					header: {
						name: "document.pdf///", // Multiple trailing slashes
						type: "file" as const,
						size: 12,
						mode: 0o644,
					},
					body: "PDF content\n",
				},
			];

			const tarBuffer = await packTarWeb(entries);
			const unpackStream = unpackTar(destDir);

			await pipeline(Readable.from([tarBuffer]), unpackStream);

			// Should create file without trailing slashes
			const filePath = path.join(destDir, "document.pdf");
			const stats = await fs.stat(filePath);
			expect(stats.isFile()).toBe(true);

			const content = await fs.readFile(filePath, "utf-8");
			expect(content).toBe("PDF content\n");
		});

		it("should handle trailing slashes on directories (which is valid)", async () => {
			const destDir = path.join(tmpDir, "extracted");

			const entries = [
				{
					header: {
						name: "valid-dir/", // This is actually valid for directories
						type: "directory" as const,
						size: 0,
						mode: 0o755,
					},
				},
			];

			const tarBuffer = await packTarWeb(entries);
			const unpackStream = unpackTar(destDir);

			await pipeline(Readable.from([tarBuffer]), unpackStream);

			// Should create directory without trailing slash
			const dirPath = path.join(destDir, "valid-dir");
			const stats = await fs.stat(dirPath);
			expect(stats.isDirectory()).toBe(true);
		});

		it("should handle nested paths with trailing slashes", async () => {
			const destDir = path.join(tmpDir, "extracted");

			const content = "nested\n";
			const entries = [
				{
					header: {
						name: "nested/path/file.txt/", // Nested file with trailing slash
						type: "file" as const,
						size: content.length, // Match actual content size
						mode: 0o644,
					},
					body: content,
				},
			];

			const tarBuffer = await packTarWeb(entries);
			const unpackStream = unpackTar(destDir);

			await pipeline(Readable.from([tarBuffer]), unpackStream);

			// Should create the nested file structure correctly
			const filePath = path.join(destDir, "nested", "path", "file.txt");
			const stats = await fs.stat(filePath);
			expect(stats.isFile()).toBe(true);

			const readContent = await fs.readFile(filePath, "utf-8");
			expect(readContent).toBe(content);
		});

		it("map filters out empty directory names", async () => {
			const sourceDir = path.join(tmpDir, "source");
			await fs.mkdir(path.join(sourceDir, "dir"), { recursive: true });

			const packStream = packTar(sourceDir);
			const packData: Buffer[] = [];
			for await (const chunk of packStream) {
				packData.push(Buffer.from(chunk));
			}

			const extractDir = path.join(tmpDir, "extract");
			const readStream = Readable.from([Buffer.concat(packData)]);

			const unpackStream = unpackTar(extractDir, {
				map(entry) {
					if (entry.name === "dir/") entry.name = ""; // Creates empty name
					return entry;
				},
			});

			// Should complete without hanging (empty entries are filtered out)
			await pipeline(readStream, unpackStream);

			// Should have no files since the only directory entry was filtered out
			try {
				const files = await fs.readdir(extractDir);
				expect(files).toHaveLength(0);
			} catch (error) {
				// If directory doesn't exist because no entries were extracted, that's fine
				expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
			}
		}, 2000);

		it("handles mapping with subdir extraction", async () => {
			// Create a test archive that mimics GitHub tarball structure
			const sourceDir = path.join(tmpDir, "source");
			const rootDir = path.join(sourceDir, "withastro-starlight-abc123");
			const examplesDir = path.join(rootDir, "examples");
			const basicsDir = path.join(examplesDir, "basics");
			const srcDir = path.join(basicsDir, "src");
			const pagesDir = path.join(srcDir, "pages");

			await fs.mkdir(pagesDir, { recursive: true });
			await fs.writeFile(
				path.join(basicsDir, "package.json"),
				'{"name": "@example/basics", "type": "module"}',
			);
			await fs.writeFile(path.join(pagesDir, "index.mdx"), "# Welcome");

			const packStream = packTar(sourceDir);
			const packData: Buffer[] = [];
			for await (const chunk of packStream) {
				packData.push(Buffer.from(chunk));
			}

			// Reproduce exact giget-core extraction logic
			const extractDir = path.join(tmpDir, "starlight-unpack");
			const readStream = Readable.from([Buffer.concat(packData)]);
			const subdir = "examples/basics/";

			const unpackStream = unpackTar(extractDir, {
				filter(entry) {
					const path = entry.name.split("/").slice(1).join("/");
					if (path === "") return false;
					return path.startsWith(subdir);
				},
				map(entry) {
					let path = entry.name.split("/").slice(1).join("/");
					if (subdir) path = path.slice(subdir.length);
					entry.name = path;
					return entry;
				},
			});

			// This should now work without hanging
			await pipeline(readStream, unpackStream);

			// Verify extraction worked correctly
			const files = await fs.readdir(extractDir, { recursive: true });
			expect(files).toContain("package.json");
			expect(files.some((f) => f.includes("pages"))).toBe(true);
		});
	});

	describe("error handling", () => {
		it("handles file close errors gracefully without unhandled rejections", async () => {
			// Test that file close/futimes errors don't cause unhandled rejections
			// which would crash the process in Node.js >=15

			const destDir = path.join(tmpDir, "extracted");
			const unhandledRejections: Error[] = [];

			// Set up listener for unhandled rejections
			const listener = (reason: Error) => {
				unhandledRejections.push(reason);
			};
			process.on("unhandledRejection", listener);

			try {
				// Create entries with mtime set (triggers futimes in close path)
				const testTime = new Date("2020-01-01T00:00:00Z");
				const entries = [
					{
						header: {
							name: "file1.txt",
							size: 5,
							type: "file" as const,
							mode: 0o644,
							mtime: testTime,
						},
						body: "hello",
					},
					{
						header: {
							name: "file2.txt",
							size: 5,
							type: "file" as const,
							mode: 0o644,
							mtime: testTime,
						},
						body: "world",
					},
				];

				const tarBuffer = await packTarWeb(entries);
				const unpackStream = unpackTar(destDir);

				await pipeline(Readable.from([tarBuffer]), unpackStream);

				// Wait a bit for any potential unhandled rejections to fire
				await new Promise((resolve) => setTimeout(resolve, 100));

				// Verify no unhandled rejections occurred
				expect(unhandledRejections).toHaveLength(0);

				// Verify files were extracted successfully
				const file1 = await fs.readFile(
					path.join(destDir, "file1.txt"),
					"utf8",
				);
				const file2 = await fs.readFile(
					path.join(destDir, "file2.txt"),
					"utf8",
				);
				expect(file1).toBe("hello");
				expect(file2).toBe("world");
			} finally {
				process.off("unhandledRejection", listener);
			}
		});
	});
});
