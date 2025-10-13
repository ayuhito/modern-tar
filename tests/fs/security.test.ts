import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packTar as packTarFS, type TarSource, unpackTar } from "../../src/fs";

import { packTar, type TarEntry } from "../../src/web";
import { INVALID_TAR } from "../web/fixtures";

describe("security", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "modern-tar-security-test-"),
		);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// Helper functions for creating malicious archives
	const createTarWithMaliciousFile = async (
		fileName: string,
	): Promise<Readable> => {
		const entries: TarEntry[] = [
			{
				header: {
					name: "safe-file.txt",
					size: 14,
					type: "file",
					mode: 0o644,
					mtime: new Date(),
					uid: 0,
					gid: 0,
				},
				body: "malicious data",
			},
			{
				header: {
					name: fileName,
					size: 14,
					type: "file",
					mode: 0o644,
					mtime: new Date(),
					uid: 0,
					gid: 0,
				},
				body: "malicious data",
			},
		];

		const tarBuffer = await packTar(entries);
		return Readable.from([tarBuffer]);
	};

	const createTarWithMaliciousDirectory = async (
		dirName: string,
	): Promise<Readable> => {
		const entries: TarEntry[] = [
			{
				header: {
					name: "safe-dir/",
					size: 0,
					type: "directory",
					mode: 0o755,
					mtime: new Date(),
					uid: 0,
					gid: 0,
				},
			},
			{
				header: {
					name: dirName,
					size: 0,
					type: "directory",
					mode: 0o755,
					mtime: new Date(),
					uid: 0,
					gid: 0,
				},
			},
		];

		const tarBuffer = await packTar(entries);
		return Readable.from([tarBuffer]);
	};

	const createTarWithMaliciousHardlink = async (
		fileName: string,
		linkTarget: string,
	): Promise<Readable> => {
		const entries: TarEntry[] = [
			{
				header: {
					name: "safe-file.txt",
					size: 14,
					type: "file",
					mode: 0o644,
					mtime: new Date(),
					uid: 0,
					gid: 0,
				},
				body: "malicious data",
			},
			{
				header: {
					name: fileName,
					size: 0,
					type: "link",
					mode: 0o644,
					mtime: new Date(),
					uid: 0,
					gid: 0,
					linkname: linkTarget,
				},
			},
		];

		const tarBuffer = await packTar(entries);
		return Readable.from([tarBuffer]);
	};

	const createTarWithSymlink = async (
		symlinkTarget: string,
	): Promise<Readable> => {
		const entries: TarEntry[] = [
			{
				header: {
					name: "safe-file.txt",
					size: 12,
					type: "file",
					mode: 0o644,
					mtime: new Date(),
					uid: 0,
					gid: 0,
				},
				body: "safe content",
			},
			{
				header: {
					name: "malicious-symlink",
					size: 0,
					type: "symlink",
					mode: 0o644,
					mtime: new Date(),
					uid: 0,
					gid: 0,
					linkname: symlinkTarget,
				},
			},
		];

		const tarBuffer = await packTar(entries);
		return Readable.from([tarBuffer]);
	};

	describe("path traversal prevention", () => {
		describe("file path traversal", () => {
			it("prevents files with relative path traversal", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar = await createTarWithMaliciousFile(
					"../../malicious.txt",
				);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Entry "../../malicious.txt" points outside the extraction directory.',
				);
			});

			it("prevents files with absolute paths", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar =
					await createTarWithMaliciousFile("/tmp/malicious.txt");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Absolute path found in "/tmp/malicious.txt".',
				);
			});

			it("prevents files with complex path traversal", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar = await createTarWithMaliciousFile(
					"./safe/../../../malicious.txt",
				);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Entry "./safe/../../../malicious.txt" points outside the extraction directory.',
				);
			});

			it("allows safe file paths within extraction directory", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const safeTar = await createTarWithMaliciousFile("subdir/safe.txt");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

				const filePath = path.join(extractDir, "subdir", "safe.txt");
				const fileContent = await fs.readFile(filePath, "utf8");
				expect(fileContent).toBe("malicious data");
			});

			it("allows files with safe relative paths", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const safeTar = await createTarWithMaliciousFile(
					"./subdir/../safe.txt",
				);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

				const filePath = path.join(extractDir, "safe.txt");
				const fileContent = await fs.readFile(filePath, "utf8");
				expect(fileContent).toBe("malicious data");
			});
		});

		describe("directory path traversal", () => {
			it("prevents directories with relative path traversal", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar =
					await createTarWithMaliciousDirectory("../../malicious/");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Entry "../../malicious/" points outside the extraction directory.',
				);
			});

			it("prevents directories with absolute paths", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar =
					await createTarWithMaliciousDirectory("/tmp/malicious/");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Absolute path found in "/tmp/malicious/".',
				);
			});

			it("allows safe directory paths", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const safeTar = await createTarWithMaliciousDirectory("subdir/nested/");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

				const dirPath = path.join(extractDir, "subdir", "nested");
				const dirStat = await fs.stat(dirPath);
				expect(dirStat.isDirectory()).toBe(true);
			});
		});

		describe("hardlink path traversal", () => {
			it("prevents hardlinks with relative path traversal in target", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar = await createTarWithMaliciousHardlink(
					"link.txt",
					"../../target.txt",
				);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Hardlink "../../target.txt" points outside the extraction directory.',
				);
			});

			it("prevents hardlinks with absolute paths in target", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar = await createTarWithMaliciousHardlink(
					"link.txt",
					"/tmp/target.txt",
				);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Hardlink "/tmp/target.txt" points outside the extraction directory.',
				);
			});

			it("allows safe hardlinks within extraction directory", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const safeTar = await createTarWithMaliciousHardlink(
					"link.txt",
					"safe-file.txt",
				);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

				const originalPath = path.join(extractDir, "safe-file.txt");
				const linkPath = path.join(extractDir, "link.txt");

				const originalStat = await fs.stat(originalPath);
				const linkStat = await fs.stat(linkPath);

				expect(originalStat.ino).toBe(linkStat.ino);
				expect(linkStat.nlink).toBe(2);
			});

			it("should silently skip self-referential hardlinks without erroring", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const entries: TarEntry[] = [
					{
						header: {
							name: "autolink",
							type: "link",
							linkname: "./autolink", // The target is the same as the name
							size: 0,
							mode: 0o644,
							mtime: new Date(),
						},
					},
				];

				const tarBuffer = await packTar(entries);
				const tarStream = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				await expect(
					pipeline(tarStream, unpackStream),
				).resolves.toBeUndefined();

				// Verify that no files were created
				const files = await fs.readdir(extractDir);
				expect(files).toEqual([]);
			});

			it("should skip self-referential hardlinks with various path formats", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				// Test different ways a self-referential link can be expressed
				const testCases = [
					{ name: "simple", linkname: "simple" },
					{ name: "dotslash", linkname: "./dotslash" },
					{ name: "nested/file", linkname: "nested/file" },
					{ name: "nested/dotfile", linkname: "./nested/dotfile" },
				];

				for (const testCase of testCases) {
					const entries: TarEntry[] = [
						{
							header: {
								name: testCase.name,
								type: "link",
								linkname: testCase.linkname,
								size: 0,
								mode: 0o644,
								mtime: new Date(),
							},
						},
					];

					const tarBuffer = await packTar(entries);
					const tarStream = Readable.from([tarBuffer]);
					const unpackStream = unpackTar(extractDir);

					// Each case should complete successfully without creating files
					await expect(
						pipeline(tarStream, unpackStream),
					).resolves.toBeUndefined();
				}

				// Verify that only parent directories were created (no actual files/links)
				const files = await fs.readdir(extractDir, { recursive: true });
				// Only "nested" directory should exist from the nested test cases
				expect(files).toEqual(["nested"]);

				// Verify that the nested directory is empty (no files were created inside it)
				const nestedFiles = await fs.readdir(path.join(extractDir, "nested"));
				expect(nestedFiles).toEqual([]);
			});

			it("should handle mixed archive with self-referential and normal hardlinks", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				// Create an archive with a normal file, a valid hardlink, and a self-referential hardlink
				const entries: TarEntry[] = [
					{
						header: {
							name: "original.txt",
							size: 12,
							type: "file",
							mode: 0o644,
							mtime: new Date(),
						},
						body: "test content",
					},
					{
						header: {
							name: "valid-link.txt",
							size: 0,
							type: "link",
							linkname: "original.txt",
							mode: 0o644,
							mtime: new Date(),
						},
					},
					{
						header: {
							name: "self-link.txt",
							size: 0,
							type: "link",
							linkname: "self-link.txt", // Self-referential
							mode: 0o644,
							mtime: new Date(),
						},
					},
				];

				const tarBuffer = await packTar(entries);
				const tarStream = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				await expect(
					pipeline(tarStream, unpackStream),
				).resolves.toBeUndefined();

				// Verify that only the original file and valid hardlink were created
				const files = (await fs.readdir(extractDir)).sort();
				expect(files).toEqual(["original.txt", "valid-link.txt"]);

				// Verify the valid hardlink works correctly
				const originalStat = await fs.stat(
					path.join(extractDir, "original.txt"),
				);
				const linkStat = await fs.stat(path.join(extractDir, "valid-link.txt"));
				expect(originalStat.ino).toBe(linkStat.ino);
				expect(linkStat.nlink).toBe(2);

				// Verify content is correct
				const content = await fs.readFile(
					path.join(extractDir, "valid-link.txt"),
					"utf-8",
				);
				expect(content).toBe("test content");
			});
		});
	});

	describe("symlink traversal prevention", () => {
		it.skipIf(process.platform === "win32")(
			"prevents symlinks pointing outside extraction directory",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar = await createTarWithSymlink("../../etc/passwd");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Symlink "../../etc/passwd" points outside the extraction directory.',
				);
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents symlinks with absolute paths outside extraction directory",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar = await createTarWithSymlink("/etc/passwd");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Symlink "/etc/passwd" points outside the extraction directory.',
				);
			},
		);

		it.skipIf(process.platform === "win32")(
			"allows safe symlinks within extraction directory",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const safeTar = await createTarWithSymlink("safe-file.txt");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

				const symlinkPath = path.join(extractDir, "malicious-symlink");
				const linkStat = await fs.lstat(symlinkPath);
				expect(linkStat.isSymbolicLink()).toBe(true);

				const linkTarget = await fs.readlink(symlinkPath);
				expect(linkTarget).toBe("safe-file.txt");
			},
		);

		it.skipIf(process.platform === "win32")(
			"allows symlinks to subdirectories within extraction directory",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const safeTar = await createTarWithSymlink("subdir/file.txt");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

				const symlinkPath = path.join(extractDir, "malicious-symlink");
				const linkStat = await fs.lstat(symlinkPath);
				expect(linkStat.isSymbolicLink()).toBe(true);

				const linkTarget = await fs.readlink(symlinkPath);
				expect(linkTarget).toBe("subdir/file.txt");
			},
		);

		it.skipIf(process.platform === "win32")(
			"validates symlinks with complex relative paths",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const safeTar = await createTarWithSymlink("./subdir/../safe-file.txt");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

				const symlinkPath = path.join(extractDir, "malicious-symlink");
				const linkStat = await fs.lstat(symlinkPath);
				expect(linkStat.isSymbolicLink()).toBe(true);
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents clever path traversal attempts",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar = await createTarWithSymlink(
					"../../../tmp/malicious",
				);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					"points outside the extraction directory",
				);
			},
		);

		it.skipIf(process.platform === "win32")(
			"validates symlinks in nested directories",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const entries: TarEntry[] = [
					{
						header: {
							name: "nested/",
							size: 0,
							type: "directory",
							mode: 0o755,
							mtime: new Date(),
							uid: 0,
							gid: 0,
						},
					},
					{
						header: {
							name: "nested/malicious-symlink",
							size: 0,
							type: "symlink",
							mode: 0o644,
							mtime: new Date(),
							uid: 0,
							gid: 0,
							linkname: "../../etc/passwd",
						},
					},
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					"points outside the extraction directory",
				);
			},
		);

		it.skipIf(process.platform === "win32")(
			"allows symlinks to the extraction directory root",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const safeTar = await createTarWithSymlink(".");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

				const symlinkPath = path.join(extractDir, "malicious-symlink");
				const linkStat = await fs.lstat(symlinkPath);
				expect(linkStat.isSymbolicLink()).toBe(true);

				const linkTarget = await fs.readlink(symlinkPath);
				expect(linkTarget).toBe(".");
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents symlinks that resolve to parent through multiple levels",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar = await createTarWithSymlink(
					"./foo/../bar/../../etc/passwd",
				);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					"points outside the extraction directory",
				);
			},
		);

		it.skipIf(process.platform === "win32")(
			"validates symlinks and prevents traversal attacks",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar = await createTarWithSymlink("../../etc/passwd");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Symlink "../../etc/passwd" points outside the extraction directory.',
				);
			},
		);
	});

	describe("malformed archives", () => {
		it.skipIf(process.platform === "win32")(
			"rejects unpacking a tar with an invalid symlink pointing outside",
			async () => {
				const extractDir = path.join(tmpDir, "extracted");
				await fs.mkdir(extractDir, { recursive: true });

				const readStream = createReadStream(INVALID_TAR);
				const unpackStream = unpackTar(extractDir);

				// This fixture contains a symlink 'foo' -> '../' which is a traversal attempt.
				await expect(pipeline(readStream, unpackStream)).rejects.toThrow(
					'Symlink "../" points outside the extraction directory.',
				);
			},
		);
	});

	describe("mixed and advanced attacks", () => {
		it("prevents multiple types of traversal in single archive", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "safe-file.txt",
						size: 4,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "safe",
				},
				{
					header: {
						name: "../../malicious-file.txt",
						size: 14,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "malicious data",
				},
				{
					header: {
						name: "../../malicious-dir/",
						size: 0,
						type: "directory",
						mode: 0o755,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				'Entry "../../malicious-file.txt" points outside the extraction directory.',
			);
		});

		it("processes safe entries before encountering traversal attempt", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "safe1.txt",
						size: 14,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "malicious data",
				},
				{
					header: {
						name: "safe-dir/",
						size: 0,
						type: "directory",
						mode: 0o755,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
				},
				{
					header: {
						name: "safe-dir/safe2.txt",
						size: 14,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "malicious data",
				},
				{
					header: {
						name: "../../../malicious.txt",
						size: 14,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "malicious data",
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				'Entry "../../../malicious.txt" points outside the extraction directory.',
			);

			// Verify that safe files were created before the error
			const safe1Path = path.join(extractDir, "safe1.txt");
			const safe2Path = path.join(extractDir, "safe-dir", "safe2.txt");

			expect(await fs.readFile(safe1Path, "utf8")).toBe("malicious data");
			expect(await fs.readFile(safe2Path, "utf8")).toBe("malicious data");

			// Verify malicious file was NOT created
			const maliciousPath = path.resolve(tmpDir, "malicious.txt");
			await expect(fs.access(maliciousPath)).rejects.toThrow();
		});
	});

	describe("edge cases", () => {
		it("allows files at extraction directory root", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "root-file.txt",
						size: 14,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "malicious data",
				},
			];

			const tarBuffer = await packTar(entries);
			const safeTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

			const filePath = path.join(extractDir, "root-file.txt");
			expect(await fs.readFile(filePath, "utf8")).toBe("malicious data");
		});

		it("handles empty path components correctly", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const safeTar = await createTarWithMaliciousFile("./safe//file.txt");
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

			const filePath = path.join(extractDir, "safe", "file.txt");
			expect(await fs.readFile(filePath, "utf8")).toBe("malicious data");
		});

		it.skipIf(process.platform === "win32")(
			"prevents traversal with Windows-style paths on Unix",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar = await createTarWithMaliciousFile(
					"..\\..\\malicious.txt",
				);
				const unpackStream = unpackTar(extractDir);

				// On Unix, this should be treated as a filename with backslashes
				await expect(
					pipeline(maliciousTar, unpackStream),
				).resolves.toBeUndefined();

				// The file should be created with the literal filename
				const filePath = path.join(extractDir, "..\\..\\malicious.txt");
				expect(await fs.readFile(filePath, "utf8")).toBe("malicious data");
			},
		);
	});

	describe("CVE-specific attacks", () => {
		it.skipIf(process.platform === "win32")(
			"prevents tar-fs symlink traversal vulnerability (CVE-2025-59343)",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				const evilDir = path.join(tmpDir, "extract-evil");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.mkdir(evilDir, { recursive: true });

				const entries: TarEntry[] = [
					{
						header: {
							name: "my-symlink",
							size: 0,
							type: "symlink",
							linkname: "../extract-evil/malicious-file.txt",
						},
					},
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Symlink "../extract-evil/malicious-file.txt" points outside the extraction directory.',
				);

				// Verify that the malicious file was NOT created
				const maliciousPath = path.join(evilDir, "malicious-file.txt");
				await expect(fs.access(maliciousPath)).rejects.toThrow();
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents hardlink through existing symlink vulnerability (CVE-2025-48387)",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				const siblingDir = path.join(tmpDir, "sibling");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.mkdir(siblingDir, { recursive: true });

				// Create target file outside extraction directory
				const targetFile = path.join(siblingDir, "victim.txt");
				await fs.writeFile(targetFile, "original content");

				// Manually create a symlink that points outside (simulating first stage of attack)
				const symlinkPath = path.join(extractDir, "escape");
				await fs.symlink("../sibling", symlinkPath);

				// Create tar with hardlink through the existing symlink
				const entries: TarEntry[] = [
					{
						header: {
							name: "malicious-hardlink",
							size: 0,
							type: "link",
							linkname: "escape/victim.txt", // This goes through symlink to external file
						},
					},
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				// This should be blocked - hardlink validation should use fs.realpath
				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					/points outside the extraction directory/,
				);

				// Verify target file is unchanged
				const content = await fs.readFile(targetFile, "utf8");
				expect(content).toBe("original content");
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents CVE-2025-48387 multi-stage symlink+hardlink attack",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				const flagDir = path.join(tmpDir, "flag");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.mkdir(flagDir, { recursive: true });

				// Create victim file outside extraction directory
				const victimFile = path.join(flagDir, "flag");
				await fs.writeFile(victimFile, "hello world\n");

				// Replicate the exact CVE PoC sequence
				const entries: TarEntry[] = [
					// Create root symlink with deep noop path + traversal
					{
						header: {
							name: "root",
							size: 0,
							type: "symlink",
							mode: 0o777,
							mtime: new Date(),
							uid: 0,
							gid: 0,
							linkname: "noop/".repeat(15) + "../".repeat(15),
						},
					},
					// Create noop symlink pointing to current directory
					{
						header: {
							name: "noop",
							size: 0,
							type: "symlink",
							mode: 0o777,
							mtime: new Date(),
							uid: 0,
							gid: 0,
							linkname: ".",
						},
					},
					// Create hardlink through the symlink chain to external file
					{
						header: {
							name: "hardflag",
							size: 0,
							type: "link",
							mode: 0o644,
							mtime: new Date(),
							uid: 0,
							gid: 0,
							linkname: `root${flagDir}/flag`,
						},
					},
					// Overwrite external file via hardlink
					{
						header: {
							name: "hardflag",
							size: 10,
							type: "file",
							mode: 0o644,
							mtime: new Date(),
							uid: 0,
							gid: 0,
						},
						body: "overwrite\n",
					},
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				// This attack should be blocked
				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					/points outside the extraction directory/,
				);

				// Verify victim file is unchanged
				const content = await fs.readFile(victimFile, "utf8");
				expect(content).toBe("hello world\n");
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents symlink chain bypass attack (CVE-2025-48387 variant)",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				const externalDir = path.join(tmpDir, "external");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.mkdir(externalDir, { recursive: true });

				const victimFile = path.join(externalDir, "victim.txt");
				await fs.writeFile(victimFile, "original");

				const entries: TarEntry[] = [
					{
						header: {
							name: "escape",
							size: 0,
							type: "symlink",
							linkname: "bridge/".repeat(10) + "../".repeat(11),
						},
					},
					{
						header: {
							name: "bridge",
							size: 0,
							type: "symlink",
							linkname: ".",
						},
					},
					{
						header: {
							name: "attack",
							size: 0,
							type: "link",
							linkname: `escape${externalDir}/victim.txt`,
						},
					},
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow();

				const content = await fs.readFile(victimFile, "utf8");
				expect(content).toBe("original");
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents multi-level symlink+hardlink combinations",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				const externalFile = path.join(tmpDir, "external.txt");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.writeFile(externalFile, "should not be modified");

				const entries: TarEntry[] = [
					{
						header: {
							name: "level1",
							size: 0,
							type: "symlink",
							linkname: "level2",
						},
					},
					{
						header: {
							name: "level2",
							size: 0,
							type: "symlink",
							linkname: "level3",
						},
					},
					{
						header: {
							name: "level3",
							size: 0,
							type: "symlink",
							linkname: "../../",
						},
					},
					{
						header: {
							name: "attack-hardlink",
							size: 0,
							type: "link",
							linkname: `level1${externalFile}`,
						},
					},
					{
						header: {
							name: "attack-hardlink",
							size: 12,
							type: "file",
						},
						body: "compromised!",
					},
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow();

				const content = await fs.readFile(externalFile, "utf8");
				expect(content).toBe("should not be modified");
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents overwrite via directory symlink+hardlink",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				const targetDir = path.join(tmpDir, "target");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.mkdir(targetDir, { recursive: true });

				const targetFile = path.join(targetDir, "important.txt");
				await fs.writeFile(targetFile, "important data");

				const entries: TarEntry[] = [
					// Create directory that we'll symlink through
					{
						header: {
							name: "gateway/",
							size: 0,
							type: "directory",
						},
					},
					// Symlink the directory to point outside
					{
						header: {
							name: "gateway/escape",
							size: 0,
							type: "symlink",
							linkname: "../../target",
						},
					},
					// Create hardlink through the symlinked path
					{
						header: {
							name: "innocent-file",
							size: 0,
							type: "link",
							linkname: "gateway/escape/important.txt",
						},
					},
					// Overwrite via the hardlink
					{
						header: {
							name: "innocent-file",
							size: 12,
							type: "file",
						},
						body: "hacked data!",
					},
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow();

				const content = await fs.readFile(targetFile, "utf8");
				expect(content).toBe("important data");
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents directory symlink overwrite cache poisoning (CVE-2021-32804)",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				const outsideDir = path.join(tmpDir, "outside");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.mkdir(outsideDir, { recursive: true });

				// This test simulates the exact CVE-2021-32804 attack pattern:
				// - Create a directory (gets cached as safe)
				// - Remove it and create a symlink with same name (cache not invalidated)
				// - Write file through symlink (cache bypass allows traversal)

				// Create the directory directly to simulate it being cached
				const attackDir = path.join(extractDir, "attack-dir");
				await fs.mkdir(attackDir, { recursive: true });

				// Remove it and create a symlink pointing outside
				await fs.rmdir(attackDir);
				await fs.symlink("../outside", attackDir);

				// Create an archive that tries to write through this symlink
				const entries: TarEntry[] = [
					{
						header: {
							name: "attack-dir/malicious-file.txt",
							type: "file",
							size: 13,
						},
						body: "pwned content",
					},
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					/Symlink .* points outside the extraction directory./,
				);

				// Verify that the malicious file was NOT created outside
				const maliciousPath = path.join(outsideDir, "malicious-file.txt");
				await expect(fs.access(maliciousPath)).rejects.toThrow();
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents symlink cache poisoning with manual directory removal",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				const targetDir = path.join(tmpDir, "target");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.mkdir(targetDir, { recursive: true });

				// Create archive with directory, then symlink at different path,
				// then try to write through a path that could be cached
				const entries: TarEntry[] = [
					{
						header: {
							name: "legit-dir/",
							type: "directory",
							mode: 0o755,
							size: 0,
						},
					},
					{
						header: {
							name: "legit-dir/subdir/",
							type: "directory",
							mode: 0o755,
							size: 0,
						},
					},
					// Create symlink that could potentially be cached as a directory
					{
						header: {
							name: "legit-dir/escape",
							type: "symlink",
							linkname: "../../target",
							size: 0,
						},
					},
					// Try to write through the symlinked path
					{
						header: {
							name: "legit-dir/escape/evil.txt",
							type: "file",
							size: 10,
						},
						body: "malicious!",
					},
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				// Should be blocked by path validation
				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					/Symlink .* points outside the extraction directory./,
				);

				// Verify no file created in target directory
				const evilPath = path.join(targetDir, "evil.txt");
				await expect(fs.access(evilPath)).rejects.toThrow();
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents Unicode normalization cache poisoning",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				const evilDir = path.join(tmpDir, "evil-output");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.mkdir(evilDir, { recursive: true });

				// Two different string representations for the same visual directory name "café"
				const dirNamePrecomposed = "caf\u00e9/"; // NFC: é as single character (U+00E9)
				const dirNameDecomposed = "cafe\u0301/"; // NFD: e + combining acute accent (U+0065 U+0301)

				// Verify these are different strings but visually identical
				expect(dirNamePrecomposed).not.toBe(dirNameDecomposed);
				expect(dirNamePrecomposed.normalize("NFKD")).toBe(
					dirNameDecomposed.normalize("NFKD"),
				);

				const entries: TarEntry[] = [
					// Create the directory with the precomposed form. This will be cached as safe.
					{
						header: {
							name: dirNamePrecomposed,
							type: "directory",
							mode: 0o755,
							size: 0,
						},
					},
					// Overwrite the directory with a symlink using the decomposed form.
					// The cache invalidation will fail because the string keys are different.
					{
						header: {
							name: dirNameDecomposed,
							type: "symlink",
							linkname: `../../${path.basename(evilDir)}`, // Points outside
							size: 0,
						},
					},
					// Write a file into the original (precomposed) directory name.
					// The code will trust the cached entry and write through the symlink.
					{
						header: {
							name: `${dirNamePrecomposed}malicious.txt`,
							type: "file",
							size: 5,
						},
						body: "pwned",
					},
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				// The fixed code should properly normalize paths and prevent cache poisoning
				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow();

				// Verify no file was created outside the extraction directory
				const maliciousPath = path.join(evilDir, "malicious.txt");
				await expect(fs.access(maliciousPath)).rejects.toThrow();
			},
		);

		it.skipIf(process.platform === "win32")(
			"properly normalizes Unicode paths in cache operations",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				// Test various Unicode normalization forms
				const testCases = [
					{
						name: "Unicode NFC vs NFD",
						path1: "test\u00e9/", // NFC: é as single character
						path2: "teste\u0301/", // NFD: e + combining acute accent
					},
					{
						name: "Unicode NFKC vs NFKD",
						path1: "test\u2126/", // NFKC: Ohm sign (Ω)
						path2: "test\u03a9/", // NFKD: Greek capital omega (Ω)
					},
				];

				for (const testCase of testCases) {
					// These should be treated as the same path after normalization
					expect(testCase.path1.normalize("NFKD")).toBe(
						testCase.path2.normalize("NFKD"),
					);

					const entries: TarEntry[] = [
						{
							header: {
								name: testCase.path1,
								type: "directory",
								mode: 0o755,
								size: 0,
							},
						},
						{
							header: {
								name: `${testCase.path1}file.txt`,
								type: "file",
								size: 4,
							},
							body: "test",
						},
						{
							header: {
								name: `${testCase.path2}file2.txt`,
								type: "file",
								size: 4,
							},
							body: "test",
						},
					];

					const tarBuffer = await packTar(entries);
					const maliciousTar = Readable.from([tarBuffer]);
					const unpackStream = unpackTar(extractDir);

					// This should work correctly with proper Unicode normalization
					await expect(
						pipeline(maliciousTar, unpackStream),
					).resolves.not.toThrow();

					// Both files should be created in the same normalized directory
					const normalizedPath = testCase.path1.normalize("NFKD");
					const file1Path = path.join(extractDir, normalizedPath, "file.txt");
					const file2Path = path.join(extractDir, normalizedPath, "file2.txt");

					await expect(fs.access(file1Path)).resolves.not.toThrow();
					await expect(fs.access(file2Path)).resolves.not.toThrow();

					// Clean up for next iteration
					await fs.rm(path.join(extractDir, normalizedPath), {
						recursive: true,
						force: true,
					});
				}
			},
		);
	});

	it("prevents DoS attacks via deeply nested paths", async () => {
		const extractDir = path.join(tmpDir, "extract");
		await fs.mkdir(extractDir, { recursive: true });

		// "a/b/c/d/..."
		const alphabet = "abcdefghijklmnopqrstuvwxyz";
		const dirs: string[] = [];
		for (let i = 0; i < 40; i++) {
			dirs.push(alphabet[i % 26]);
		}
		const deepPath = `${dirs.join("/")}/file.txt`;

		const entries: TarEntry[] = [
			{
				header: {
					name: deepPath,
					type: "file",
					size: 4,
				},
				body: "test",
			},
		];

		const tarBuffer = await packTar(entries);
		const maliciousTar = Readable.from([tarBuffer]);
		const unpackStream = unpackTar(extractDir, { maxDepth: 30 }); // Set limit lower than our path

		// Should be blocked due to excessive path depth
		await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
			"Tar exceeds max specified depth.",
		);

		// Verify that no deeply nested directories were created
		const firstLevel = path.join(extractDir, "a");
		await expect(fs.access(firstLevel)).rejects.toThrow();
	});

	it("allows extraction when path depth is within limit", async () => {
		const extractDir = path.join(tmpDir, "extract");
		await fs.mkdir(extractDir, { recursive: true });

		const dirs = ["a", "b", "c", "d", "e"];
		const deepPath = `${dirs.join("/")}/file.txt`;
		const expectedDepth = dirs.length + 1; // +1 for file.txt

		const entries: TarEntry[] = [
			{
				header: {
					name: deepPath,
					type: "file",
					size: 4,
				},
				body: "test",
			},
		];

		const tarBuffer = await packTar(entries);
		const maliciousTar = Readable.from([tarBuffer]);
		const unpackStream = unpackTar(extractDir, { maxDepth: expectedDepth });

		// Should succeed as it's exactly at the limit
		await expect(pipeline(maliciousTar, unpackStream)).resolves.not.toThrow();

		// Verify the file was created at the deep path
		const deepFilePath = path.join(extractDir, deepPath);
		await expect(fs.access(deepFilePath)).resolves.not.toThrow();
		const content = await fs.readFile(deepFilePath, "utf8");
		expect(content).toBe("test");
	});

	it("respects custom maxDepth option", async () => {
		const extractDir = path.join(tmpDir, "extract");
		await fs.mkdir(extractDir, { recursive: true });

		// Create an entry with a path depth of 5
		const moderatePath = "a/b/c/d/e/file.txt";
		const entries: TarEntry[] = [
			{
				header: {
					name: moderatePath,
					type: "file",
					size: 4,
				},
				body: "test",
			},
		];

		const tarBuffer = await packTar(entries);
		const maliciousTar = Readable.from([tarBuffer]);
		const unpackStream = unpackTar(extractDir, { maxDepth: 4 });

		// Should be blocked due to custom maxDepth of 4
		await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
			"Tar exceeds max specified depth.",
		);

		// Verify that no directories were created
		const firstLevel = path.join(extractDir, "a");
		await expect(fs.access(firstLevel)).rejects.toThrow();
	});

	it("allows infinite depth when maxDepth is set to Infinity", async () => {
		const extractDir = path.join(tmpDir, "extract");
		await fs.mkdir(extractDir, { recursive: true });

		// Create an entry with a very deep path
		const deepPath = `${"a/".repeat(50)}file.txt`;
		const entries: TarEntry[] = [
			{
				header: {
					name: deepPath,
					type: "file",
					size: 4,
				},
				body: "test",
			},
		];

		const tarBuffer = await packTar(entries);
		const maliciousTar = Readable.from([tarBuffer]);
		const unpackStream = unpackTar(extractDir, { maxDepth: Infinity });

		// Should succeed with infinite depth
		await expect(pipeline(maliciousTar, unpackStream)).resolves.not.toThrow();

		// Verify the file was created at the deep path
		const deepFilePath = path.join(extractDir, deepPath);
		await expect(fs.access(deepFilePath)).resolves.not.toThrow();
		const content = await fs.readFile(deepFilePath, "utf8");
		expect(content).toBe("test");
	});

	it("prevents resource exhaustion from many nested directories", async () => {
		const extractDir = path.join(tmpDir, "extract");
		await fs.mkdir(extractDir, { recursive: true });
		const entries: TarEntry[] = [];

		// Create 50 entries each with 20-level deep paths = 50 * 20 = 1000 directory operations
		for (let i = 0; i < 50; i++) {
			const deepPath = `dir${i}/${"sub/".repeat(19)}file.txt`;
			entries.push({
				header: {
					name: deepPath,
					type: "file",
					size: 4,
				},
				body: "test",
			});
		}

		const tarBuffer = await packTar(entries);
		const maliciousTar = Readable.from([tarBuffer]);
		const unpackStream = unpackTar(extractDir, { maxDepth: 15 }); // Limit to 15 levels

		// Should be blocked due to exceeding maxDepth
		await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
			"Tar exceeds max specified depth.",
		);

		// Verify that no deeply nested directories were created
		const firstEntry = path.join(extractDir, "dir0");
		await expect(fs.access(firstEntry)).rejects.toThrow();
	});

	it.skipIf(process.platform === "win32")(
		"prevents symlink to parent followed by file creation attack",
		async () => {
			const extractDir = path.join(tmpDir, "extract");
			const parentDir = path.dirname(extractDir);
			await fs.mkdir(extractDir, { recursive: true });

			// This test replicates a common attack pattern:
			// 1. Create a symlink 'escape-dir' pointing to '../'
			// 2. Create a file 'escape-dir/malicious-file.txt' which escapes to parent
			const entries: TarEntry[] = [
				{
					header: {
						name: "escape-dir",
						size: 0,
						type: "symlink",
						mode: 0o777,
						mtime: new Date(),
						uid: 0,
						gid: 0,
						linkname: "../",
					},
				},
				{
					header: {
						name: "escape-dir/malicious-file.txt",
						size: 15,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "escaped content",
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			// Should fail due to symlink pointing outside extraction directory
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				/points outside the extraction directory/,
			);

			// Verify that malicious-file.txt was NOT created in parent directory
			const maliciousPath = path.join(parentDir, "malicious-file.txt");
			await expect(fs.access(maliciousPath)).rejects.toThrow();
		},
	);

	it.skipIf(process.platform === "win32")(
		"prevents nested symlink chain traversal attack",
		async () => {
			const extractDir = path.join(tmpDir, "extract");
			const parentDir = path.dirname(extractDir);
			await fs.mkdir(extractDir, { recursive: true });

			// This test creates a chain of symlinks to bypass naive validation:
			// level1 -> level2 -> level3 -> ../../
			// Then tries to write level1/malicious.txt
			const entries: TarEntry[] = [
				{
					header: {
						name: "level1",
						size: 0,
						type: "symlink",
						mode: 0o777,
						mtime: new Date(),
						uid: 0,
						gid: 0,
						linkname: "level2",
					},
				},
				{
					header: {
						name: "level2",
						size: 0,
						type: "symlink",
						mode: 0o777,
						mtime: new Date(),
						uid: 0,
						gid: 0,
						linkname: "level3",
					},
				},
				{
					header: {
						name: "level3",
						size: 0,
						type: "symlink",
						mode: 0o777,
						mtime: new Date(),
						uid: 0,
						gid: 0,
						linkname: "../../",
					},
				},
				{
					header: {
						name: "level1/malicious.txt",
						size: 18,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "chained traversal!",
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				/points outside the extraction directory/,
			);

			const maliciousPath = path.join(parentDir, "malicious.txt");
			await expect(fs.access(maliciousPath)).rejects.toThrow();
		},
	);

	it.skipIf(process.platform === "win32")(
		"prevents type confusion attack (directory vs file)",
		async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "my-config/",
						size: 0,
						type: "directory",
						mode: 0o755,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
				},
				{
					header: {
						name: "my-config", // Same name but without trailing slash (file)
						size: 12,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "config data!",
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow();

			// Verify the directory still exists and wasn't corrupted
			const configDirPath = path.join(extractDir, "my-config");
			const stats = await fs.stat(configDirPath);
			expect(stats.isDirectory()).toBe(true);

			// Verify no file was created with the same name
			const configFilePath = path.join(extractDir, "my-config");
			const configStats = await fs.stat(configFilePath);
			expect(configStats.isFile()).toBe(false);
		},
	);

	describe("path collision and concurrency edge cases", () => {
		it("handles directory then file with same normalized path", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "config/",
						size: 0,
						type: "directory",
						mode: 0o755,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
				},
				{
					header: {
						name: "config", // Same path without trailing slash
						size: 4,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "test",
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			// Should reject due to path conflict
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				/Path conflict.*cannot create file over existing directory/,
			);

			// Directory should still exist (first entry wins)
			const configPath = path.join(extractDir, "config");
			const stats = await fs.stat(configPath);
			expect(stats.isDirectory()).toBe(true);
		});

		it("handles file then directory with same normalized path", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "data",
						size: 8,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "filedata",
				},
				{
					header: {
						name: "data/", // Same path but as directory
						size: 0,
						type: "directory",
						mode: 0o755,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			// Should reject due to path conflict
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				/Path conflict.*cannot create directory over existing file/,
			);

			// File should still exist (first entry wins)
			const dataPath = path.join(extractDir, "data");
			const stats = await fs.stat(dataPath);
			expect(stats.isFile()).toBe(true);
		});

		it("handles multiple entries with conflicting normalized paths", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "shared/",
						size: 0,
						type: "directory",
						mode: 0o755,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
				},
				{
					header: {
						name: "shared",
						size: 5,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "file1",
				},
				{
					header: {
						name: "shared/",
						size: 0,
						type: "directory",
						mode: 0o755,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			// Should reject due to type conflict
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow();

			// Only the first directory should exist
			const sharedPath = path.join(extractDir, "shared");
			const stats = await fs.stat(sharedPath);
			expect(stats.isDirectory()).toBe(true);
		});

		it("handles unicode normalization conflicts", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// These strings normalize to the same value but are different
			const name1 = "café"; // composed form
			const name2 = "cafe\u0301"; // decomposed form (e + combining acute accent)

			const entries: TarEntry[] = [
				{
					header: {
						name: `${name1}/`,
						size: 0,
						type: "directory",
						mode: 0o755,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
				},
				{
					header: {
						name: name2,
						size: 8,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "conflict",
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			// Should reject due to normalized path conflict
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				/Path conflict.*cannot create file over existing directory/,
			);
		});

		it("allows legitimate same-type operations on same path", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "docs/",
						size: 0,
						type: "directory",
						mode: 0o755,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
				},
				{
					header: {
						name: "docs/", // Same directory again
						size: 0,
						type: "directory",
						mode: 0o755,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
				},
			];

			const tarBuffer = await packTar(entries);
			const tarStream = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			// Should succeed - creating same directory twice is OK
			await expect(pipeline(tarStream, unpackStream)).resolves.toBeUndefined();

			const docsPath = path.join(extractDir, "docs");
			const stats = await fs.stat(docsPath);
			expect(stats.isDirectory()).toBe(true);
		});

		it("handles path separator edge cases", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "folder/",
						size: 0,
						type: "directory",
						mode: 0o755,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
				},
				{
					header: {
						name: "folder//", // Double slash should normalize to same path
						size: 4,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "test",
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			// Should handle path normalization correctly and reject conflict
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				/Path conflict.*cannot create file over existing directory/,
			);
		});
	});

	describe("pack security vulnerabilities", () => {
		it.skipIf(process.platform === "win32")(
			"prevents symlink directory traversal during packing with dereference: true",
			async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });

				// Create a legitimate file outside the source directory
				const outsideFile = path.join(tmpDir, "secret.txt");
				await fs.writeFile(outsideFile, "secret data");

				// Create a malicious symlink inside the source directory that points outside
				const maliciousSymlink = path.join(sourceDir, "evil-link");
				await fs.symlink(outsideFile, maliciousSymlink);

				// Create a safe file in the source directory
				const safeFile = path.join(sourceDir, "safe.txt");
				await fs.writeFile(safeFile, "safe data");

				// When packing with dereference: true, the symlink should be followed
				// but the resulting path should be validated to prevent traversal
				const packStream = packTarFS(sourceDir, { dereference: true });

				// Collect the tar data
				const chunks: Buffer[] = [];
				packStream.on("data", (chunk) => chunks.push(chunk));

				await new Promise<void>((resolve, reject) => {
					packStream.on("end", resolve);
					packStream.on("error", reject);
				});

				const tarBuffer = Buffer.concat(chunks);

				// Extract to verify contents
				const extractDir = path.join(tmpDir, "extracted");
				await fs.mkdir(extractDir, { recursive: true });

				const extractStream = unpackTar(extractDir);
				await pipeline(Readable.from([tarBuffer]), extractStream);

				// The archive should only contain the safe file, not the symlinked file
				const extractedFiles = await fs.readdir(extractDir);
				expect(extractedFiles).toEqual(["safe.txt"]);

				// Verify the safe file was extracted correctly
				const extractedContent = await fs.readFile(
					path.join(extractDir, "safe.txt"),
					"utf8",
				);
				expect(extractedContent).toBe("safe data");

				// The malicious symlink should not have been included in the archive
				expect(extractedFiles).not.toContain("evil-link");
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents complex symlink directory traversal during packing",
			async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });

				// Create nested directories to make the attack more complex
				const nestedDir = path.join(sourceDir, "nested");
				await fs.mkdir(nestedDir, { recursive: true });

				// Create a target file outside the source directory
				const outsideFile = path.join(tmpDir, "sensitive.txt");
				await fs.writeFile(outsideFile, "sensitive information");

				// Create a complex symlink that tries to escape using relative paths
				const complexSymlink = path.join(nestedDir, "complex-link");
				await fs.symlink("../../sensitive.txt", complexSymlink);

				// Pack with dereference: true
				const packStream = packTarFS(sourceDir, { dereference: true });

				const chunks: Buffer[] = [];
				packStream.on("data", (chunk) => chunks.push(chunk));

				await new Promise<void>((resolve, reject) => {
					packStream.on("end", resolve);
					packStream.on("error", reject);
				});

				const tarBuffer = Buffer.concat(chunks);

				// Extract and verify
				const extractDir = path.join(tmpDir, "extracted");
				await fs.mkdir(extractDir, { recursive: true });

				const extractStream = unpackTar(extractDir);
				await pipeline(Readable.from([tarBuffer]), extractStream);

				// Should only contain the nested directory, not the symlinked file
				const extractedFiles = await fs.readdir(extractDir);
				expect(extractedFiles).toEqual(["nested"]);

				const nestedFiles = await fs.readdir(path.join(extractDir, "nested"));
				expect(nestedFiles).toEqual([]);
			},
		);

		it.skipIf(process.platform === "win32")(
			"allows legitimate symlinks within base directory with dereference: true",
			async () => {
				const sourceDir = path.join(tmpDir, "source");
				await fs.mkdir(sourceDir, { recursive: true });

				// Create a legitimate file within the source directory
				const targetFile = path.join(sourceDir, "target.txt");
				await fs.writeFile(targetFile, "legitimate content");

				// Create a legitimate symlink within the source directory
				const legitimateSymlink = path.join(sourceDir, "good-link");
				await fs.symlink("target.txt", legitimateSymlink);

				// Pack with dereference: true - should include the symlinked content
				const packStream = packTarFS(sourceDir, { dereference: true });

				const chunks: Buffer[] = [];
				packStream.on("data", (chunk) => chunks.push(chunk));

				await new Promise<void>((resolve, reject) => {
					packStream.on("end", resolve);
					packStream.on("error", reject);
				});

				const tarBuffer = Buffer.concat(chunks);

				// Extract and verify contents
				const extractDir = path.join(tmpDir, "extracted");
				await fs.mkdir(extractDir, { recursive: true });

				const extractStream = unpackTar(extractDir);
				await pipeline(Readable.from([tarBuffer]), extractStream);

				// Should contain both the original file and the symlinked file
				const extractedFiles = await fs.readdir(extractDir);
				expect(extractedFiles.sort()).toEqual(["good-link", "target.txt"]);

				// Both files should have the same content since the symlink was dereferenced
				const originalContent = await fs.readFile(
					path.join(extractDir, "target.txt"),
					"utf8",
				);
				const symlinkedContent = await fs.readFile(
					path.join(extractDir, "good-link"),
					"utf8",
				);
				expect(originalContent).toBe("legitimate content");
				expect(symlinkedContent).toBe("legitimate content");
			},
		);

		it.skipIf(process.platform === "win32")(
			"allows manual baseDir specification for custom security boundaries",
			async () => {
				const tmpRoot = path.join(tmpDir, "workspace");
				const allowedDir = path.join(tmpRoot, "allowed");
				const forbiddenDir = path.join(tmpRoot, "forbidden");

				await fs.mkdir(allowedDir, { recursive: true });
				await fs.mkdir(forbiddenDir, { recursive: true });

				// Create files in both directories
				const allowedFile = path.join(allowedDir, "allowed.txt");
				const forbiddenFile = path.join(forbiddenDir, "forbidden.txt");
				await fs.writeFile(allowedFile, "allowed content");
				await fs.writeFile(forbiddenFile, "forbidden content");

				// Create a source directory with symlinks to both
				const sourceDir = path.join(tmpRoot, "source");
				await fs.mkdir(sourceDir);

				const allowedSymlink = path.join(sourceDir, "allowed-link");
				const forbiddenSymlink = path.join(sourceDir, "forbidden-link");
				await fs.symlink(allowedFile, allowedSymlink);
				await fs.symlink(forbiddenFile, forbiddenSymlink);

				// Use packTarSources with custom baseDir to only allow files from allowedDir
				const sources: TarSource[] = [
					{ type: "file", source: allowedSymlink, target: "allowed-link" },
					{ type: "file", source: forbiddenSymlink, target: "forbidden-link" },
				];

				const packStream = packTarFS(sources, {
					dereference: true,
					baseDir: allowedDir, // Custom security boundary
				});

				const chunks: Buffer[] = [];
				packStream.on("data", (chunk) => chunks.push(chunk));

				await new Promise<void>((resolve, reject) => {
					packStream.on("end", resolve);
					packStream.on("error", reject);
				});

				const tarBuffer = Buffer.concat(chunks);

				// Extract and verify
				const extractDir = path.join(tmpDir, "extracted");
				await fs.mkdir(extractDir, { recursive: true });

				const extractStream = unpackTar(extractDir);
				await pipeline(Readable.from([tarBuffer]), extractStream);

				const extractedFiles = await fs.readdir(extractDir);

				// Should only contain the allowed symlink, forbidden one should be blocked
				expect(extractedFiles).toEqual(["allowed-link"]);

				const content = await fs.readFile(
					path.join(extractDir, "allowed-link"),
					"utf8",
				);
				expect(content).toBe("allowed content");
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents pack time symlink path traversal vulnerability",
			async () => {
				const sourceDir = path.join(tmpDir, "source");
				const evilDir = path.join(tmpDir, "source-evil");
				await fs.mkdir(sourceDir, { recursive: true });
				await fs.mkdir(evilDir, { recursive: true });

				// Create a sensitive file outside the intended base directory
				const sensitiveFile = path.join(evilDir, "secret.txt");
				await fs.writeFile(sensitiveFile, "classified information");

				// Create a malicious symlink that uses the vulnerable startsWith check
				// This symlink name starts with the baseDir string but points outside it
				const maliciousSymlink = path.join(sourceDir, "exploit");
				await fs.symlink(
					`../${path.basename(evilDir)}/secret.txt`,
					maliciousSymlink,
				);

				// Pack with dereference: true should NOT include the symlinked content
				const packStream = packTarFS(sourceDir, { dereference: true });

				const chunks: Buffer[] = [];
				packStream.on("data", (chunk) => chunks.push(chunk));

				await new Promise<void>((resolve, reject) => {
					packStream.on("end", resolve);
					packStream.on("error", reject);
				});

				const tarBuffer = Buffer.concat(chunks);

				// Extract and verify the malicious symlink was excluded
				const extractDir = path.join(tmpDir, "extracted");
				await fs.mkdir(extractDir, { recursive: true });

				const extractStream = unpackTar(extractDir);
				await pipeline(Readable.from([tarBuffer]), extractStream);

				// Should be empty - the unsafe symlink should have been filtered out
				const extractedFiles = await fs.readdir(extractDir);
				expect(extractedFiles).toEqual([]);
			},
		);

		it.skipIf(process.platform === "win32")(
			"show path prefix vulnerability would be exploitable with just vulnerable startsWith check",
			async () => {
				const baseDir = path.join(tmpDir, "archive");
				const maliciousDir = path.join(tmpDir, "archive-evil");
				await fs.mkdir(baseDir, { recursive: true });
				await fs.mkdir(maliciousDir, { recursive: true });

				// Create target file in the malicious directory
				const targetFile = path.join(maliciousDir, "stolen.txt");
				await fs.writeFile(targetFile, "stolen data");

				// Create a symlink that would pass a naive startsWith check
				// because "archive-evil" starts with "archive"
				const exploitSymlink = path.join(baseDir, "exploit");
				await fs.symlink(
					`../${path.basename(maliciousDir)}/stolen.txt`,
					exploitSymlink,
				);

				// Verify that resolvedTarget would start with baseDir string (vulnerable check)
				const linkTarget = await fs.readlink(exploitSymlink);
				const resolvedTarget = path.resolve(
					path.dirname(exploitSymlink),
					linkTarget,
				);

				// This would pass the vulnerable check: resolvedTarget.startsWith(baseDir)
				expect(resolvedTarget.startsWith(baseDir)).toBe(true);

				// But should fail our fixed check: resolvedTarget === baseDir || resolvedTarget.startsWith(baseDir + path.sep)
				const isSafe =
					resolvedTarget === baseDir ||
					resolvedTarget.startsWith(baseDir + path.sep);
				expect(isSafe).toBe(false);

				// Pack with dereference: true - should exclude the unsafe symlink
				const packStream = packTarFS(baseDir, { dereference: true });

				const chunks: Buffer[] = [];
				packStream.on("data", (chunk) => chunks.push(chunk));

				await new Promise<void>((resolve, reject) => {
					packStream.on("end", resolve);
					packStream.on("error", reject);
				});

				const tarBuffer = Buffer.concat(chunks);

				// Extract and verify no files were included
				const extractDir = path.join(tmpDir, "extracted");
				await fs.mkdir(extractDir, { recursive: true });

				const extractStream = unpackTar(extractDir);
				await pipeline(Readable.from([tarBuffer]), extractStream);

				const extractedFiles = await fs.readdir(extractDir);
				expect(extractedFiles).toEqual([]);
			},
		);
	});

	it("prevents alignment DoS vulnerability in isZeroBlock", async () => {
		// Verifies that unaligned data chunks don't cause RangeError crashes
		const extractDir = path.join(tmpDir, "extract");
		await fs.mkdir(extractDir, { recursive: true });

		const entries: TarEntry[] = [
			{
				header: { name: "test.txt", type: "file", size: 4 },
				body: "test",
			},
		];

		const tarBuffer = await packTar(entries);

		// Test unaligned chunking that would crash vulnerable version
		let sent = false;
		const unalignedStream = new Readable({
			read() {
				if (!sent) {
					this.push(tarBuffer.subarray(0, 513)); // Unaligned chunk
					this.push(tarBuffer.subarray(513));
					this.push(null);
					sent = true;
				}
			},
		});

		const unpackStream = unpackTar(extractDir);
		await expect(
			pipeline(unalignedStream, unpackStream),
		).resolves.not.toThrow();

		const content = await fs.readFile(
			path.join(extractDir, "test.txt"),
			"utf8",
		);
		expect(content).toBe("test");
	});
});
