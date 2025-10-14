import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unpackTar } from "../../src/fs";
import { normalizeName } from "../../src/fs/path";
import { packTar, type TarEntry } from "../../src/web";

describe("fs path normalization", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "modern-tar-win-security-test-"),
		);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// Helper function to create tar with specific entries
	const createTarWithEntries = async (
		entries: TarEntry[],
	): Promise<Readable> => {
		const tarBuffer = await packTar(entries);
		return Readable.from([tarBuffer]);
	};

	describe("normalizeName function", () => {
		it("normalizes basic paths", () => {
			expect(normalizeName("path/to/file")).toBe("path/to/file");
			expect(normalizeName("path\\to\\file")).toBe("path/to/file");
		});

		it("strips absolute paths", () => {
			expect(normalizeName("/tmp/file.txt")).toBe("tmp/file.txt");
			expect(normalizeName("C:/windows/file.txt")).toBe("windows/file.txt");
			expect(normalizeName("D:\\data\\file.txt")).toBe("data/file.txt");
		});

		it("throws on drive letter traversal", () => {
			expect(() => normalizeName("C:../evil")).toThrow(
				"C:../evil points outside extraction directory",
			);
			expect(() => normalizeName("D:..\\bad")).toThrow(
				"D:..\\bad points outside extraction directory",
			);
		});

		it.skipIf(process.platform !== "win32")(
			"encodes Windows reserved characters on Windows",
			() => {
				expect(normalizeName("file<name")).toContain("\uF03C");
				expect(normalizeName("file>name")).toContain("\uF03E");
				expect(normalizeName("file|name")).toContain("\uF07C");
			},
		);

		it.skipIf(process.platform === "win32")(
			"preserves reserved characters on non-Windows",
			() => {
				expect(normalizeName("file<name")).toBe("file<name");
				expect(normalizeName("file>name")).toBe("file>name");
				expect(normalizeName("file|name")).toBe("file|name");
			},
		);
	});

	describe("windows drive letter traversal prevention", () => {
		it("should reject C:../path traversal attempts", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "C:../etc/passwd",
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

			const maliciousTar = await createTarWithEntries(entries);
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				"C:../etc/passwd points outside extraction directory",
			);

			// Verify no files were created due to rejection
			const files = await fs.readdir(extractDir);
			expect(files).toHaveLength(0);
		});

		it("should reject C:../path traversal universally", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "C:../etc/passwd",
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

			const tarStream = await createTarWithEntries(entries);
			const unpackStream = unpackTar(extractDir);

			// Should reject traversal attempts on all platforms
			await expect(pipeline(tarStream, unpackStream)).rejects.toThrow(
				"C:../etc/passwd points outside extraction directory",
			);
		});

		it("should reject D:../../sensitive traversal attempts", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "D:../../sensitive/data.txt",
						size: 12,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "secret data!",
				},
			];

			const maliciousTar = await createTarWithEntries(entries);
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				"D:../../sensitive/data.txt points outside extraction directory",
			);
		});

		it("should reject case-insensitive drive letter traversal (c:../)", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "c:../malicious.txt",
						size: 9,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "malicious",
				},
			];

			const maliciousTar = await createTarWithEntries(entries);
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				"c:../malicious.txt points outside extraction directory",
			);
		});
	});

	describe("windows drive letter stripping", () => {
		it("should strip C: prefix from filenames universally", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "C:safe-file.txt",
						size: 12,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "safe content",
				},
			];

			const tarStream = await createTarWithEntries(entries);
			const unpackStream = unpackTar(extractDir);

			await pipeline(tarStream, unpackStream);

			// Should exist as 'safe-file.txt', not 'C:safe-file.txt'
			const files = await fs.readdir(extractDir);
			expect(files).toContain("safe-file.txt");
			expect(files).not.toContain("C:safe-file.txt");

			const content = await fs.readFile(
				path.join(extractDir, "safe-file.txt"),
				"utf8",
			);
			expect(content).toBe("safe content");
		});

		it("should strip C: prefix for tar compatibility", async () => {
			// Drive letters are always stripped for tar file portability
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "C:safe-file.txt",
						size: 13,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "test content!",
				},
			];

			const tarStream = await createTarWithEntries(entries);
			const unpackStream = unpackTar(extractDir);

			await pipeline(tarStream, unpackStream);

			// Drive letter should be stripped for tar compatibility
			const files = await fs.readdir(extractDir);
			expect(files).toContain("safe-file.txt");

			const content = await fs.readFile(
				path.join(extractDir, "safe-file.txt"),
				"utf-8",
			);
			expect(content).toBe("test content!");
		});

		it("should strip various drive letters (A:, Z:, etc.) universally", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "A:fileA.txt",
						size: 5,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "dataA",
				},
				{
					header: {
						name: "Z:fileZ.txt",
						size: 5,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "dataZ",
				},
			];

			const tarStream = await createTarWithEntries(entries);
			const unpackStream = unpackTar(extractDir);

			await pipeline(tarStream, unpackStream);

			const files = await fs.readdir(extractDir);
			expect(files.sort()).toEqual(["fileA.txt", "fileZ.txt"]);
		});

		it("should handle nested paths with drive letters universally", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "C:dir/subdir/file.txt",
						size: 7,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "content",
				},
			];

			const tarStream = await createTarWithEntries(entries);
			const unpackStream = unpackTar(extractDir);

			await pipeline(tarStream, unpackStream);

			// Should create dir/subdir/file.txt (without C:)
			const filePath = path.join(extractDir, "dir", "subdir", "file.txt");
			const content = await fs.readFile(filePath, "utf8");
			expect(content).toBe("content");
		});
	});

	describe("windows reserved character encoding", () => {
		it.skipIf(process.platform !== "win32")(
			"should encode reserved characters on Windows",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const entries: TarEntry[] = [
					{
						header: {
							name: 'file:name<test>file|data?.txt"end',
							size: 12,
							type: "file",
							mode: 0o644,
							mtime: new Date(),
							uid: 0,
							gid: 0,
						},
						body: "test content",
					},
				];

				const tarStream = await createTarWithEntries(entries);
				const unpackStream = unpackTar(extractDir);

				await pipeline(tarStream, unpackStream);

				const files = await fs.readdir(extractDir);
				expect(files).toHaveLength(1);

				// Should have encoded reserved characters
				const expectedName =
					"file\uF03Aname\uF03Ctest\uF03Efile\uF07Cdata\uF03F.txt\uF022end";
				expect(files[0]).toBe(expectedName);

				const content = await fs.readFile(
					path.join(extractDir, files[0]),
					"utf8",
				);
				expect(content).toBe("test content");
			},
		);

		it.skipIf(process.platform === "win32")(
			"should preserve reserved characters on Unix",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const entries: TarEntry[] = [
					{
						header: {
							name: 'file:name<test>file|data?.txt"end',
							size: 12,
							type: "file",
							mode: 0o644,
							mtime: new Date(),
							uid: 0,
							gid: 0,
						},
						body: "test content",
					},
				];

				const tarStream = await createTarWithEntries(entries);
				const unpackStream = unpackTar(extractDir);

				await pipeline(tarStream, unpackStream);

				const files = await fs.readdir(extractDir);
				expect(files).toHaveLength(1);

				// On Unix, reserved characters should be preserved
				expect(files[0]).toBe('file:name<test>file|data?.txt"end');

				const content = await fs.readFile(
					path.join(extractDir, files[0]),
					"utf8",
				);
				expect(content).toBe("test content");
			},
		);

		it.skipIf(process.platform !== "win32")(
			"should encode asterisk and pipe characters on Windows",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const entries: TarEntry[] = [
					{
						header: {
							name: "wild*card|pipe.txt",
							size: 4,
							type: "file",
							mode: 0o644,
							mtime: new Date(),
							uid: 0,
							gid: 0,
						},
						body: "data",
					},
				];

				const tarStream = await createTarWithEntries(entries);
				const unpackStream = unpackTar(extractDir);

				await pipeline(tarStream, unpackStream);

				const files = await fs.readdir(extractDir);
				expect(files[0]).toBe("wild\uF02Acard\uF07Cpipe.txt");
			},
		);
	});

	describe("Windows backslash normalization", () => {
		it("should normalize backslashes to forward slashes universally", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "dir\\subdir\\file.txt",
						size: 7,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "content",
				},
			];

			const tarStream = await createTarWithEntries(entries);
			const unpackStream = unpackTar(extractDir);

			await pipeline(tarStream, unpackStream);

			// Should create proper directory structure
			const filePath = path.join(extractDir, "dir", "subdir", "file.txt");
			const content = await fs.readFile(filePath, "utf8");
			expect(content).toBe("content");
		});

		it("should normalize backslashes to forward slashes for tar compatibility", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "dir\\subdir\\file.txt",
						size: 7,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "content",
				},
			];

			const tarStream = await createTarWithEntries(entries);
			const unpackStream = unpackTar(extractDir);

			await pipeline(tarStream, unpackStream);

			// Backslashes are normalized to forward slashes for tar compatibility
			const files = await fs.readdir(extractDir);
			expect(files).toContain("dir");
		});

		it("should handle mixed slashes and backslashes universally", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "mixed/path\\with\\both/slashes.txt",
						size: 5,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "mixed",
				},
			];

			const tarStream = await createTarWithEntries(entries);
			const unpackStream = unpackTar(extractDir);

			await pipeline(tarStream, unpackStream);

			// Should normalize all to forward slashes and create proper structure
			const filePath = path.join(
				extractDir,
				"mixed",
				"path",
				"with",
				"both",
				"slashes.txt",
			);
			const content = await fs.readFile(filePath, "utf8");
			expect(content).toBe("mixed");
		});
	});

	describe("Combined Windows path issues", () => {
		it.skipIf(process.platform !== "win32")(
			"should handle drive letter + reserved chars + backslashes on Windows",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const entries: TarEntry[] = [
					{
						header: {
							name: "C:dir\\sub:dir\\file<name>.txt",
							size: 8,
							type: "file",
							mode: 0o644,
							mtime: new Date(),
							uid: 0,
							gid: 0,
						},
						body: "combined",
					},
				];

				const tarStream = await createTarWithEntries(entries);
				const unpackStream = unpackTar(extractDir);

				await pipeline(tarStream, unpackStream);

				// Check that the extracted file has proper encoding
				const expectedPath = path.join(
					extractDir,
					"dir",
					"sub\uF03Adir",
					"file\uF03Cname\uF03E.txt",
				);
				const content = await fs.readFile(expectedPath, "utf8");
				expect(content).toBe("combined");
			},
		);

		it.skipIf(process.platform === "win32")(
			"should handle drive letter stripping and slash normalization on Unix",
			async () => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const entries: TarEntry[] = [
					{
						header: {
							name: "C:dir\\sub:dir\\file<name>.txt",
							size: 8,
							type: "file",
							mode: 0o644,
							mtime: new Date(),
							uid: 0,
							gid: 0,
						},
						body: "combined",
					},
				];

				const tarStream = await createTarWithEntries(entries);
				const unpackStream = unpackTar(extractDir);

				await pipeline(tarStream, unpackStream);

				// On Unix, characters are preserved (not encoded), drive letter stripped, slashes normalized
				const expectedPath = path.join(
					extractDir,
					"dir",
					"sub:dir",
					"file<name>.txt",
				);
				const content = await fs.readFile(expectedPath, "utf8");
				expect(content).toBe("combined");
			},
		);

		it("should reject drive traversal even with encoded characters", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "C:..\\..\\evil<file>.txt",
						size: 4,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "evil",
				},
			];

			const maliciousTar = await createTarWithEntries(entries);
			const unpackStream = unpackTar(extractDir);

			// Should still be rejected due to drive letter traversal
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				"C:..\\..\\evil<file>.txt points outside extraction directory",
			);
		});
	});

	describe("additional normalizeName tests", () => {
		it("should normalize paths consistently across platforms", () => {
			const testPath = "C:test\\file<name>.txt";
			const result = normalizeName(testPath);

			if (process.platform === "win32") {
				expect(result).toBe("test/file\uF03Cname\uF03E.txt");
			} else {
				expect(result).toBe("test/file<name>.txt"); // Characters preserved on Unix
			}
		});

		it.skipIf(process.platform !== "win32")(
			"should handle edge cases in drive letter detection on Windows",
			() => {
				// These should NOT be treated as drive letters (multi-char or non-letter)
				expect(normalizeName("CC:file.txt")).toBe("CC\uF03Afile.txt");
				expect(normalizeName("1:file.txt")).toBe("1\uF03Afile.txt");
				expect(normalizeName(":file.txt")).toBe("\uF03Afile.txt");
			},
		);

		it.skipIf(process.platform === "win32")(
			"should handle edge cases in drive letter detection on Unix",
			() => {
				// These should NOT be treated as drive letters (multi-char or non-letter)
				// Characters are preserved on Unix (not encoded)
				expect(normalizeName("CC:file.txt")).toBe("CC:file.txt");
				expect(normalizeName("1:file.txt")).toBe("1:file.txt");
				expect(normalizeName(":file.txt")).toBe(":file.txt");
			},
		);

		it("should reject various drive letter traversal patterns", () => {
			const patterns = [
				"C:../path",
				"D:..\\path",
				"Z:..",
				"A:../../../etc/passwd",
			];

			for (const pattern of patterns) {
				expect(() => normalizeName(pattern)).toThrow(
					`${pattern} points outside extraction directory`,
				);
			}
		});

		it.skipIf(process.platform !== "win32")(
			"should handle empty and edge case paths on Windows",
			() => {
				expect(normalizeName("")).toBe("");
				expect(normalizeName("/")).toBe("");
				expect(normalizeName("\\")).toBe("");
				expect(normalizeName("C:\\")).toBe("");
			},
		);
	});

	describe("cross-platform compatibility with map option", () => {
		it("should allow custom path transformation via map option", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "C:test\\file<name>.txt",
						size: 14,
						type: "file",
						mode: 0o644,
						mtime: new Date(),
						uid: 0,
						gid: 0,
					},
					body: "cross-platform",
				},
			];

			const tarStream = await createTarWithEntries(entries);
			const unpackStream = unpackTar(extractDir, {
				map: (header) => {
					// Custom transformation that always applies Windows-style normalization
					let normalized = header.name.replace(/\\/g, "/");
					normalized = normalized.replace(/^[A-Za-z]:/, "");
					normalized = normalized.replace(/[<>:"|?*]/g, (char) => {
						const replacements: { [key: string]: string } = {
							":": "\uF03A",
							"<": "\uF03C",
							">": "\uF03E",
							"|": "\uF07C",
							"?": "\uF03F",
							"*": "\uF02A",
							'"': "\uF022",
						};
						return replacements[char];
					});

					return {
						...header,
						name: normalized,
					};
				},
			});

			await pipeline(tarStream, unpackStream);

			// Should create normalized path structure on any platform
			const expectedPath = path.join(
				extractDir,
				"test",
				"file\uF03Cname\uF03E.txt",
			);
			const content = await fs.readFile(expectedPath, "utf8");
			expect(content).toBe("cross-platform");
		});
	});
});
