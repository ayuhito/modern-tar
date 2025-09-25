import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unpackTar } from "../../src/fs/index";
import type { TarEntry } from "../../src/web/index";
import { packTar } from "../../src/web/index";

describe("path traversal prevention", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "modern-tar-path-traversal-test-"),
		);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

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

	describe("file path traversal", () => {
		it("prevents files with relative path traversal", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a malicious tar with file path pointing outside extraction directory
			const maliciousTar = await createTarWithMaliciousFile(
				"../../malicious.txt",
			);
			const unpackStream = unpackTar(extractDir);

			// This should throw an error
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				'Path traversal attempt detected for entry "../../malicious.txt".',
			);
		});

		it("prevents files with absolute paths", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a malicious tar with absolute path
			const maliciousTar =
				await createTarWithMaliciousFile("/tmp/malicious.txt");
			const unpackStream = unpackTar(extractDir);

			// This should throw an error
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				'Path traversal attempt detected for entry "/tmp/malicious.txt".',
			);
		});

		it("prevents files with complex path traversal", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a malicious tar with complex traversal
			const maliciousTar = await createTarWithMaliciousFile(
				"./safe/../../../malicious.txt",
			);
			const unpackStream = unpackTar(extractDir);

			// This should throw an error
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				'Path traversal attempt detected for entry "./safe/../../../malicious.txt".',
			);
		});

		it("allows safe file paths within extraction directory", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a safe tar with file in subdirectory
			const safeTar = await createTarWithMaliciousFile("subdir/safe.txt");
			const unpackStream = unpackTar(extractDir);

			// This should succeed
			await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

			// Verify the file was created in the correct location
			const filePath = path.join(extractDir, "subdir", "safe.txt");
			const fileContent = await fs.readFile(filePath, "utf8");
			expect(fileContent).toBe("malicious data");
		});

		it("allows files with safe relative paths", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a tar with safe relative path that stays within bounds
			const safeTar = await createTarWithMaliciousFile("./subdir/../safe.txt");
			const unpackStream = unpackTar(extractDir);

			// This should succeed as the resolved path is within the extraction directory
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

			// Create a malicious tar with directory path pointing outside extraction directory
			const maliciousTar =
				await createTarWithMaliciousDirectory("../../malicious/");
			const unpackStream = unpackTar(extractDir);

			// This should throw an error
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				'Path traversal attempt detected for entry "../../malicious/".',
			);
		});

		it("prevents directories with absolute paths", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a malicious tar with absolute directory path
			const maliciousTar =
				await createTarWithMaliciousDirectory("/tmp/malicious/");
			const unpackStream = unpackTar(extractDir);

			// This should throw an error
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				'Path traversal attempt detected for entry "/tmp/malicious/".',
			);
		});

		it("allows safe directory paths", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a safe tar with directory
			const safeTar = await createTarWithMaliciousDirectory("subdir/nested/");
			const unpackStream = unpackTar(extractDir);

			// This should succeed
			await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

			// Verify the directory was created
			const dirPath = path.join(extractDir, "subdir", "nested");
			const dirStat = await fs.stat(dirPath);
			expect(dirStat.isDirectory()).toBe(true);
		});
	});

	describe("hardlink path traversal", () => {
		it("prevents hardlinks with relative path traversal in target", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a malicious tar with hardlink target pointing outside extraction directory
			const maliciousTar = await createTarWithMaliciousHardlink(
				"link.txt",
				"../../target.txt",
			);
			const unpackStream = unpackTar(extractDir);

			// This should throw an error
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				'Hardlink target "../../target.txt" points outside the extraction directory.',
			);
		});

		it("prevents hardlinks with absolute paths in target", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a malicious tar with absolute hardlink target
			const maliciousTar = await createTarWithMaliciousHardlink(
				"link.txt",
				"/tmp/target.txt",
			);
			const unpackStream = unpackTar(extractDir);

			// This should throw an error
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				'Hardlink target "/tmp/target.txt" points outside the extraction directory.',
			);
		});

		it("allows safe hardlinks within extraction directory", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a safe tar with hardlink to existing file
			const safeTar = await createTarWithMaliciousHardlink(
				"link.txt",
				"safe-file.txt",
			);
			const unpackStream = unpackTar(extractDir);

			// This should succeed
			await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

			// Verify both files exist and are hardlinked
			const originalPath = path.join(extractDir, "safe-file.txt");
			const linkPath = path.join(extractDir, "link.txt");

			const originalStat = await fs.stat(originalPath);
			const linkStat = await fs.stat(linkPath);

			// They should have the same inode (hardlinked)
			expect(originalStat.ino).toBe(linkStat.ino);
			expect(linkStat.nlink).toBe(2); // Two links to the same file
		});
	});

	describe("mixed traversal attempts", () => {
		it("prevents multiple types of traversal in single archive", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create an archive with multiple traversal attempts
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

			// This should throw an error on the first malicious entry
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				"Path traversal attempt detected",
			);
		});

		it("processes safe entries before encountering traversal attempt", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create an archive with safe entries first, then malicious
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

			// This should throw an error
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

			// Create a tar with file at root (empty name would be invalid, so use ".")
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

			// Create a tar with path containing empty components
			const safeTar = await createTarWithMaliciousFile("./safe//file.txt");
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

			// The file should be created (path.resolve handles empty components)
			const filePath = path.join(extractDir, "safe", "file.txt");
			expect(await fs.readFile(filePath, "utf8")).toBe("malicious data");
		});

		it.skipIf(process.platform === "win32")(
			"prevents traversal with Windows-style paths on Unix",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				// Try Windows-style path traversal (should be treated as filename on Unix)
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
