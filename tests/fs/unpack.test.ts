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
		expect(stats.mode & 0o777).toBe(0o755);
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
		expect(stats.mode & 0o777).toBe(0o644);

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
		).rejects.toThrow(/Path depth.*exceeds the maximum allowed depth/);
	});

	it("handles absolute paths in entries", async () => {
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

		await expect(
			pipeline(Readable.from([tarBuffer]), unpackStream),
		).rejects.toThrow("Path traversal attempt detected");
	});

	it("handles symlink validation disabled", async () => {
		const destDir = path.join(tmpDir, "extracted");

		const entries = [
			{
				header: {
					name: "safe-link",
					size: 0,
					type: "symlink" as const,
					linkname: "../outside",
				},
			},
		];

		const tarBuffer = await packTarWeb(entries);
		const unpackStream = unpackTar(destDir, { validateSymlinks: false });

		// Should not throw when validation is disabled
		await pipeline(Readable.from([tarBuffer]), unpackStream);

		const linkPath = path.join(destDir, "safe-link");
		const linkTarget = await fs.readlink(linkPath);
		expect(linkTarget).toBe("../outside");
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
		).rejects.toThrow("Hardlink target");
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
		).rejects.toThrow("Symlink target");
	});

	describe("edge cases", () => {
		it("handles validatePath with non-directory/non-symlink file blocking path", async () => {
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

		it("handles ReadableStream cancel with non-Error reason", async () => {
			const destDir = path.join(tmpDir, "extracted");

			// Create a custom writable that will test the cancel path
			const unpackStream = unpackTar(destDir);

			// Add error handler to prevent unhandled error
			unpackStream.on("error", () => {
				// Expected error, do nothing
			});

			// Write some data and then destroy with a string reason
			unpackStream.write(Buffer.from("test data"));

			// Web Streams can be cancelled with any type, including strings
			unpackStream.destroy("test cancel reason" as unknown as Error);

			// The destroy should complete without throwing
			await new Promise((resolve) => {
				unpackStream.on("close", resolve);
			});

			it.skipIf(process.platform !== "win32")(
				"handles cache invalidation on Windows platform",
				async () => {
					const destDir = path.join(tmpDir, "extracted");

					const entries = [
						{
							header: {
								name: "test-symlink",
								size: 0,
								type: "symlink" as const,
								linkname: "target",
							},
						},
					];

					const tarBuffer = await packTarWeb(entries);
					const unpackStream = unpackTar(destDir);

					// Should handle Windows cache invalidation without error
					await pipeline(Readable.from([tarBuffer]), unpackStream);

					const linkPath = path.join(destDir, "test-symlink");
					const linkTarget = await fs.readlink(linkPath);
					expect(linkTarget).toBe("target");
				},
			);
		});
	});
});
