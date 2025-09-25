import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unpackTar } from "../../src/fs/index";
import type { TarEntry } from "../../src/web/index";
import { packTar } from "../../src/web/index";
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
					'Path traversal attempt detected for entry "../../malicious.txt".',
				);
			});

			it("prevents files with absolute paths", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar =
					await createTarWithMaliciousFile("/tmp/malicious.txt");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Path traversal attempt detected for entry "/tmp/malicious.txt".',
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
					'Path traversal attempt detected for entry "./safe/../../../malicious.txt".',
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
					'Path traversal attempt detected for entry "../../malicious/".',
				);
			});

			it("prevents directories with absolute paths", async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar =
					await createTarWithMaliciousDirectory("/tmp/malicious/");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Path traversal attempt detected for entry "/tmp/malicious/".',
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
					'Hardlink target "../../target.txt" points outside the extraction directory.',
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
					'Hardlink target "/tmp/target.txt" points outside the extraction directory.',
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
					'Symlink target "../../etc/passwd" points outside the extraction directory.',
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
					'Symlink target "/etc/passwd" points outside the extraction directory.',
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
			"allows bypassing symlink validation when disabled",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar = await createTarWithSymlink("../outside-file.txt");
				const unpackStream = unpackTar(extractDir, { validateSymlinks: false });

				await expect(
					pipeline(maliciousTar, unpackStream),
				).resolves.toBeUndefined();

				const symlinkPath = path.join(extractDir, "malicious-symlink");
				const linkStat = await fs.lstat(symlinkPath);
				expect(linkStat.isSymbolicLink()).toBe(true);

				const linkTarget = await fs.readlink(symlinkPath);
				expect(linkTarget).toBe("../outside-file.txt");
			},
		);

		it.skipIf(process.platform === "win32")(
			"validates symlinks by default (validateSymlinks: true is the default)",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar = await createTarWithSymlink("../../etc/passwd");
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Symlink target "../../etc/passwd" points outside the extraction directory.',
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
					'Symlink target "../" points outside the extraction directory.',
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
				"Path traversal attempt detected",
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
				"Path traversal attempt detected",
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
});
