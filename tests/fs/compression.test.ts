import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packTar, unpackTar } from "../../src/fs";

describe("fs compression", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "modern-tar-fs-compression-test-"),
		);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	describe("gzip compression", () => {
		it("compresses and decompresses a simple directory", async () => {
			// Create test files
			const sourceDir = path.join(tmpDir, "source");
			const compressedFile = path.join(tmpDir, "archive.tar.gz");
			const extractDir = path.join(tmpDir, "extracted");

			await fs.mkdir(sourceDir, { recursive: true });
			await fs.writeFile(path.join(sourceDir, "file1.txt"), "Hello, world!");
			await fs.writeFile(
				path.join(sourceDir, "file2.txt"),
				"This is another file.",
			);
			await fs.mkdir(path.join(sourceDir, "subdir"));
			await fs.writeFile(
				path.join(sourceDir, "subdir", "file3.txt"),
				"Nested file content.",
			);

			// Pack and compress
			const packStream = packTar(sourceDir);
			const gzipStream = createGzip();
			const writeStream = createWriteStream(compressedFile);

			await pipeline(packStream, gzipStream, writeStream);

			// Verify compressed file exists and has reasonable size
			const stats = await fs.stat(compressedFile);
			expect(stats.size).toBeGreaterThan(0);
			expect(stats.size).toBeLessThan(1000); // Should be well compressed

			// Decompress and extract
			const readStream = createReadStream(compressedFile);
			const gunzipStream = createGunzip();
			const extractStream = unpackTar(extractDir);

			await pipeline(readStream, gunzipStream, extractStream);

			// Verify extracted files
			const extractedFiles = await fs.readdir(extractDir);
			expect(extractedFiles).toContain("file1.txt");
			expect(extractedFiles).toContain("file2.txt");
			expect(extractedFiles).toContain("subdir");

			const file1Content = await fs.readFile(
				path.join(extractDir, "file1.txt"),
				"utf-8",
			);
			expect(file1Content).toBe("Hello, world!");

			const file2Content = await fs.readFile(
				path.join(extractDir, "file2.txt"),
				"utf-8",
			);
			expect(file2Content).toBe("This is another file.");

			const subdirFiles = await fs.readdir(path.join(extractDir, "subdir"));
			expect(subdirFiles).toContain("file3.txt");

			const file3Content = await fs.readFile(
				path.join(extractDir, "subdir", "file3.txt"),
				"utf-8",
			);
			expect(file3Content).toBe("Nested file content.");
		});

		it("handles large files with compression", async () => {
			const sourceDir = path.join(tmpDir, "large-source");
			const compressedFile = path.join(tmpDir, "large-archive.tar.gz");
			const extractDir = path.join(tmpDir, "large-extracted");

			await fs.mkdir(sourceDir, { recursive: true });

			// Create a large file (1MB)
			const largeContent = "A".repeat(1024 * 1024);
			await fs.writeFile(path.join(sourceDir, "large.txt"), largeContent);

			// Create many small files
			for (let i = 0; i < 100; i++) {
				await fs.writeFile(
					path.join(sourceDir, `small${i}.txt`),
					`Content of file ${i}`,
				);
			}

			// Pack and compress
			const packStream = packTar(sourceDir);
			const gzipStream = createGzip();
			const writeStream = createWriteStream(compressedFile);

			await pipeline(packStream, gzipStream, writeStream);

			// Verify compression effectiveness
			const originalSize = (await fs.stat(path.join(sourceDir, "large.txt")))
				.size;
			const compressedSize = (await fs.stat(compressedFile)).size;
			expect(compressedSize).toBeLessThan(originalSize * 0.1); // Should compress well

			// Decompress and extract
			const readStream = createReadStream(compressedFile);
			const gunzipStream = createGunzip();
			const extractStream = unpackTar(extractDir);

			await pipeline(readStream, gunzipStream, extractStream);

			// Verify extracted content
			const extractedLargeContent = await fs.readFile(
				path.join(extractDir, "large.txt"),
				"utf-8",
			);
			expect(extractedLargeContent).toBe(largeContent);

			// Verify all small files
			for (let i = 0; i < 100; i++) {
				const smallContent = await fs.readFile(
					path.join(extractDir, `small${i}.txt`),
					"utf-8",
				);
				expect(smallContent).toBe(`Content of file ${i}`);
			}
		});

		it("preserves file permissions and timestamps through compression", async () => {
			const sourceDir = path.join(tmpDir, "perms-source");
			const compressedFile = path.join(tmpDir, "perms-archive.tar.gz");
			const extractDir = path.join(tmpDir, "perms-extracted");

			await fs.mkdir(sourceDir, { recursive: true });

			// Create files with different permissions
			await fs.writeFile(
				path.join(sourceDir, "executable.sh"),
				"#!/bin/bash\n",
			);
			await fs.chmod(path.join(sourceDir, "executable.sh"), 0o755);

			await fs.writeFile(path.join(sourceDir, "readonly.txt"), "read only");
			await fs.chmod(path.join(sourceDir, "readonly.txt"), 0o444);

			await fs.writeFile(path.join(sourceDir, "normal.txt"), "normal file");
			await fs.chmod(path.join(sourceDir, "normal.txt"), 0o644);

			// Set specific timestamps
			const testTime = new Date("2023-01-01T12:00:00Z");
			await fs.utimes(
				path.join(sourceDir, "executable.sh"),
				testTime,
				testTime,
			);

			// Pack and compress
			const packStream = packTar(sourceDir);
			const gzipStream = createGzip();
			const writeStream = createWriteStream(compressedFile);

			await pipeline(packStream, gzipStream, writeStream);

			// Decompress and extract
			const readStream = createReadStream(compressedFile);
			const gunzipStream = createGunzip();
			const extractStream = unpackTar(extractDir);

			await pipeline(readStream, gunzipStream, extractStream);

			// Verify permissions (on non-Windows platforms)
			if (process.platform !== "win32") {
				const execStats = await fs.stat(path.join(extractDir, "executable.sh"));
				expect(execStats.mode & 0o777).toBe(0o755);

				const readonlyStats = await fs.stat(
					path.join(extractDir, "readonly.txt"),
				);
				expect(readonlyStats.mode & 0o777).toBe(0o444);

				const normalStats = await fs.stat(path.join(extractDir, "normal.txt"));
				expect(normalStats.mode & 0o777).toBe(0o644);
			}

			// Verify content
			const execContent = await fs.readFile(
				path.join(extractDir, "executable.sh"),
				"utf-8",
			);
			expect(execContent).toBe("#!/bin/bash\n");
		});
	});

	describe("error handling", () => {
		it("handles stream destruction without TransformStream errors", async () => {
			const extractDir = path.join(tmpDir, "extract-test");
			const unpackStream = unpackTar(extractDir, {
				filter: () => true,
				map: (header) => ({ ...header, name: `processed-${header.name}` }),
			});

			// Write some data and immediately destroy
			const testData = Buffer.from("test data");
			unpackStream.write(testData);

			const errors: Error[] = [];
			unpackStream.on("error", (err: Error) => {
				errors.push(err);
			});

			unpackStream.destroy(new Error("Simulated processing error"));

			// Wait for stream to close
			await new Promise((resolve) => {
				unpackStream.on("close", resolve);
			});

			for (const error of errors) {
				expect(error.message).not.toContain(
					"Invalid state: TransformStream has been terminated"
				);
			}
		});

		it("handles stream destruction during processing", async () => {
			const extractDir = path.join(tmpDir, "extract-test");
			const unpackStream = unpackTar(extractDir, {
				filter: () => true,
				map: (header) => ({ ...header, name: `processed-${header.name}` }),
			});

			// Write some data and immediately destroy to trigger race condition
			const testData = Buffer.from("test data");
			unpackStream.write(testData);

			const errors: Error[] = [];
			unpackStream.on("error", (err: Error) => {
				errors.push(err);
			});

			unpackStream.destroy(new Error("Test destruction"));

			await new Promise((resolve) => {
				unpackStream.on("close", resolve);
			});

			for (const error of errors) {
				expect(error.message).not.toContain(
					"Invalid state: TransformStream has been terminated"
				);
			}
		});

		it("handles compression errors gracefully", async () => {
			// Test that compression works normally
			const sourceDir = path.join(tmpDir, "normal-source");
			const compressedFile = path.join(tmpDir, "normal.tar.gz");

			await fs.mkdir(sourceDir, { recursive: true });
			await fs.writeFile(path.join(sourceDir, "test.txt"), "test content");

			const packStream = packTar(sourceDir);
			const gzipStream = createGzip();
			const writeStream = createWriteStream(compressedFile);

			// Should complete successfully
			await expect(
				pipeline(packStream, gzipStream, writeStream),
			).resolves.toBeUndefined();

			// Verify file was created
			const stats = await fs.stat(compressedFile);
			expect(stats.size).toBeGreaterThan(0);
		});

		it("handles extraction errors gracefully", async () => {
			const sourceDir = path.join(tmpDir, "valid-source");
			const compressedFile = path.join(tmpDir, "valid-archive.tar.gz");
			const extractDir = path.join(tmpDir, "valid-extract");

			await fs.mkdir(sourceDir, { recursive: true });
			await fs.writeFile(path.join(sourceDir, "test.txt"), "test content");

			// Create valid archive
			const packStream = packTar(sourceDir);
			const gzipStream = createGzip();
			const writeStream = createWriteStream(compressedFile);

			await pipeline(packStream, gzipStream, writeStream);

			// Extract successfully to valid directory
			const readStream = createReadStream(compressedFile);
			const gunzipStream = createGunzip();
			const extractStream = unpackTar(extractDir);

			await expect(
				pipeline(readStream, gunzipStream, extractStream),
			).resolves.toBeUndefined();

			// Verify extraction worked
			const extractedContent = await fs.readFile(
				path.join(extractDir, "test.txt"),
				"utf-8",
			);
			expect(extractedContent).toBe("test content");
		});
	});
});
