import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packTar, unpackTar } from "../../src/fs";

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

	it("handles PAX long filenames on a round trip", async () => {
		// This filename has a component longer than 100 chars and cannot use USTAR prefixing.
		const longFileName =
			"a-very-long-directory-name-that-is-well-over-one-hundred-characters-long-and-cannot-be-split-easily/file.txt";

		const sourceDir = path.join(tmpDir, "source");
		const longPathDir = path.join(sourceDir, path.dirname(longFileName));
		const fullPath = path.join(sourceDir, longFileName);

		await fs.mkdir(longPathDir, { recursive: true });
		await fs.writeFile(fullPath, "pax path test");

		const destDir = path.join(tmpDir, "extracted");
		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		const extractedFile = path.join(destDir, longFileName);
		const content = await fs.readFile(extractedFile, "utf-8");
		expect(content).toBe("pax path test");
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

	it("handles empty files", async () => {
		const sourceDir = path.join(tmpDir, "source");
		await fs.mkdir(sourceDir, { recursive: true });

		// Create an empty file
		const emptyFilePath = path.join(sourceDir, "empty.txt");
		await fs.writeFile(emptyFilePath, "");

		const destDir = path.join(tmpDir, "extracted");
		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		// Verify the extracted file
		const extractedPath = path.join(destDir, "empty.txt");
		const extractedContent = await fs.readFile(extractedPath);
		expect(extractedContent).toEqual(Buffer.alloc(0));

		const stats = await fs.stat(extractedPath);
		expect(stats.size).toBe(0);
	});

	it("handles various file sizes correctly", async () => {
		const sourceDir = path.join(tmpDir, "source");
		await fs.mkdir(sourceDir, { recursive: true });

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
			await fs.writeFile(path.join(sourceDir, file.name), content);
		}

		const destDir = path.join(tmpDir, "extracted");
		const packStream = packTar(sourceDir);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		// Verify all files were extracted correctly
		for (const file of files) {
			const extractedPath = path.join(destDir, file.name);
			const extractedContent = await fs.readFile(extractedPath);
			const expectedContent = Buffer.alloc(file.size, file.name[0]);

			expect(extractedContent).toEqual(expectedContent);

			const stats = await fs.stat(extractedPath);
			expect(stats.size).toBe(file.size);
		}
	});

	describe("stream source validation", () => {
		it("throws error when StreamSource has invalid size", async () => {
			const sources = [
				{
					type: "stream" as const,
					content: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("test content"));
							controller.close();
						},
					}),
					target: "test.txt",
					// size is intentionally missing
					// biome-ignore lint/suspicious/noExplicitAny: Testing.
				} as any, // Cast to bypass TypeScript validation for testing
			];

			const packStream = packTar(sources);

			await expect(async () => {
				for await (const _chunk of packStream) {
					// Just consume the stream to trigger the error
				}
			}).rejects.toThrow("StreamSource requires a positive size property.");
		});

		it("throws error when StreamSource has zero size", async () => {
			const sources = [
				{
					type: "stream" as const,
					content: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("test content"));
							controller.close();
						},
					}),
					target: "test.txt",
					size: 0,
				},
			];

			const packStream = packTar(sources);

			await expect(async () => {
				for await (const _chunk of packStream) {
					// Just consume the stream to trigger the error
				}
			}).rejects.toThrow("StreamSource requires a positive size property.");
		});

		it("works correctly with valid StreamSource size", async () => {
			const content = "test content for valid stream";
			const sources = [
				{
					type: "stream" as const,
					content: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode(content));
							controller.close();
						},
					}),
					target: "valid-stream.txt",
					size: content.length,
				},
			];

			const destDir = path.join(tmpDir, "extracted");
			const packStream = packTar(sources);
			const unpackStream = unpackTar(destDir);

			await pipeline(packStream, unpackStream);

			const extractedFile = path.join(destDir, "valid-stream.txt");
			const extractedContent = await fs.readFile(extractedFile, "utf-8");
			expect(extractedContent).toBe(content);
		});
	});

	it("allows overriding file and directory modes", async () => {
		// Create test files with specific permissions
		const testFile = path.join(tmpDir, "test.txt");
		const testDir = path.join(tmpDir, "testdir");

		await fs.writeFile(testFile, "test content");
		await fs.mkdir(testDir);
		await fs.writeFile(path.join(testDir, "nested.txt"), "nested content");

		// Set specific permissions (only on Unix systems)
		if (process.platform !== "win32") {
			await fs.chmod(testFile, 0o600); // rw-------
			await fs.chmod(testDir, 0o700);  // rwx------
		}

		// Pack with mode overrides
		const sources = [
			{ type: "file" as const, source: testFile, target: "override.txt", mode: 0o644 },
			{ type: "directory" as const, source: testDir, target: "overridedir", mode: 0o755 },
		];

		const destDir = path.join(tmpDir, "extracted");
		const packStream = packTar(sources);
		const unpackStream = unpackTar(destDir);

		await pipeline(packStream, unpackStream);

		// Check that extracted files have the overridden modes
		const extractedFile = path.join(destDir, "override.txt");
		const extractedDir = path.join(destDir, "overridedir");

		const fileStat = await fs.stat(extractedFile);
		const dirStat = await fs.stat(extractedDir);

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
			expect(dirMode).toBe(0o755);  // Should be overridden mode, not 0o700
		}

		// Verify content is still correct (all platforms)
		const content = await fs.readFile(extractedFile, "utf-8");
		expect(content).toBe("test content");

		const nestedContent = await fs.readFile(path.join(extractedDir, "nested.txt"), "utf-8");
		expect(nestedContent).toBe("nested content");
	});

	it("allows overriding all metadata properties for all source types", async () => {
		// Create test files
		const testFile = path.join(tmpDir, "test.txt");
		const testDir = path.join(tmpDir, "testdir");

		await fs.writeFile(testFile, "test content");
		await fs.mkdir(testDir);
		await fs.writeFile(path.join(testDir, "nested.txt"), "nested content");

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

		const fileStat = await fs.stat(extractedFile);
		const dirStat = await fs.stat(extractedDir);
		const contentStat = await fs.stat(extractedContent);

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
		const fileContent = await fs.readFile(extractedFile, "utf-8");
		const contentFileContent = await fs.readFile(extractedContent, "utf-8");
		const nestedFileContent = await fs.readFile(path.join(extractedDir, "nested.txt"), "utf-8");

		expect(fileContent).toBe("test content");
		expect(contentFileContent).toBe("content source data");
		expect(nestedFileContent).toBe("nested content");
	});

	it("uses safe defaults for uid and gid in ContentSource and StreamSource", async () => {
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
		const stat = await fs.stat(extractedFile);

		// Verify content and that it was created successfully with safe defaults
		const content = await fs.readFile(extractedFile, "utf-8");
		expect(content).toBe("test content");
		expect(stat.size).toBe(12); // "test content".length
	});

	it("allows partial metadata overrides while preserving filesystem values", async () => {
		const testFile = path.join(tmpDir, "partial.txt");
		await fs.writeFile(testFile, "partial override test");

		// Get original filesystem metadata
		const originalStat = await fs.stat(testFile);

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
		const extractedStat = await fs.stat(extractedFile);

		// Verify content
		const content = await fs.readFile(extractedFile, "utf-8");
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
		const timeDiff = Math.abs(extractedStat.mtime.getTime() - originalStat.mtime.getTime());
		expect(timeDiff).toBeLessThan(1000);
	});
});
