import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect } from "vitest";
import { unpackTar } from "../../../src/fs";
import { packTar, type TarEntry } from "../../../src/web";
import { it } from "../../helpers/test";
import {
	createTarWithMaliciousDirectory,
	createTarWithMaliciousFile,
} from "./helpers";

describe("path containment", () => {
	describe("file path traversal", () => {
		it("prevents files with relative path traversal", async ({ tmpDir }) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const maliciousTar = await createTarWithMaliciousFile(
				"../../malicious.txt",
			);
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				"../../malicious.txt points outside extraction directory",
			);
		});

		it("strips absolute paths from files", async ({ tmpDir }) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const maliciousTar =
				await createTarWithMaliciousFile("/tmp/malicious.txt");
			const unpackStream = unpackTar(extractDir);

			// Should succeed by stripping the absolute path prefix
			await expect(
				pipeline(maliciousTar, unpackStream),
			).resolves.toBeUndefined();

			// File should be extracted with stripped path: tmp/malicious.txt
			const filePath = path.join(extractDir, "tmp", "malicious.txt");
			const fileContent = await fs.readFile(filePath, "utf8");
			expect(fileContent).toBe("malicious data");
		});

		it("prevents files with complex path traversal", async ({ tmpDir }) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const maliciousTar = await createTarWithMaliciousFile(
				"./safe/../../../malicious.txt",
			);
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				"./safe/../../../malicious.txt points outside extraction directory",
			);
		});

		it("allows safe file paths within extraction directory", async ({
			tmpDir,
		}) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const safeTar = await createTarWithMaliciousFile("subdir/safe.txt");
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

			const filePath = path.join(extractDir, "subdir", "safe.txt");
			const fileContent = await fs.readFile(filePath, "utf8");
			expect(fileContent).toBe("malicious data");
		});

		it("rejects paths with traversal patterns even if they resolve safely", async ({
			tmpDir,
		}) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const safeTar = await createTarWithMaliciousFile("./subdir/../safe.txt");
			const unpackStream = unpackTar(extractDir);

			// Strict security: reject any path containing /../ even if it resolves safely
			await expect(pipeline(safeTar, unpackStream)).rejects.toThrow(
				"./subdir/../safe.txt points outside extraction directory",
			);
		});
	});

	describe("directory path traversal", () => {
		it("prevents directories with relative path traversal", async ({
			tmpDir,
		}) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const maliciousTar =
				await createTarWithMaliciousDirectory("../../malicious/");
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				"../../malicious points outside extraction directory",
			);
		});

		it("strips absolute paths from directories", async ({ tmpDir }) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const maliciousTar =
				await createTarWithMaliciousDirectory("/tmp/malicious/");
			const unpackStream = unpackTar(extractDir);

			// Should succeed by stripping the absolute path prefix
			await expect(
				pipeline(maliciousTar, unpackStream),
			).resolves.toBeUndefined();

			// Directory should be created with stripped path: tmp/malicious/
			const dirPath = path.join(extractDir, "tmp", "malicious");
			const dirStat = await fs.stat(dirPath);
			expect(dirStat.isDirectory()).toBe(true);
		});

		it("allows safe directory paths", async ({ tmpDir }) => {
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

	describe("mixed and advanced attacks", () => {
		it("prevents multiple types of traversal in single archive", async ({
			tmpDir,
		}) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "safe-file.txt",
						size: 4,
						type: "file",
						mode: 0o644,
					},
					body: "safe",
				},
				{
					header: {
						name: "../../malicious-file.txt",
						size: 14,
						type: "file",
						mode: 0o644,
					},
					body: "malicious data",
				},
				{
					header: {
						name: "../../malicious-dir/",
						size: 0,
						type: "directory",
						mode: 0o755,
					},
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				"../../malicious-file.txt points outside extraction directory",
			);
		});

		it("processes safe entries before encountering traversal attempt", async ({
			tmpDir,
		}) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "safe1.txt",
						size: 9,
						type: "file",
						mode: 0o644,
					},
					body: "safe data",
				},
				{
					header: {
						name: "safe-dir/",
						size: 0,
						type: "directory",
						mode: 0o755,
					},
				},
				{
					header: {
						name: "../../../malicious.txt",
						size: 14,
						type: "file",
						mode: 0o644,
					},
					body: "malicious data",
				},
				{
					header: {
						name: "safe-dir/safe2.txt",
						size: 9,
						type: "file",
						mode: 0o644,
					},
					body: "safe data",
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir, { concurrency: 1 });

			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				"../../../malicious.txt points outside extraction directory",
			);

			// Only the first two safe entries should be processed before malicious entry causes failure
			const files = await fs.readdir(extractDir);
			expect(files).toContain("safe1.txt");
			expect(files).toContain("safe-dir");
			expect(files).toHaveLength(2);

			// Verify the third entry (safe-dir/safe2.txt) was NOT created due to early abort
			const safeDirContents = await fs
				.readdir(path.join(extractDir, "safe-dir"))
				.catch(() => []);
			expect(safeDirContents).toHaveLength(0);

			// Verify malicious file was NOT created
			const maliciousPath = path.resolve(tmpDir, "malicious.txt");
			await expect(fs.access(maliciousPath)).rejects.toThrow();
		});
	});

	describe("edge cases", () => {
		it("allows files at extraction directory root", async ({ tmpDir }) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "root-file.txt",
						size: 14,
						type: "file",
						mode: 0o644,
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

		it("handles empty path components correctly", async ({ tmpDir }) => {
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
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const maliciousTar = await createTarWithMaliciousFile(
					"..\\..\\malicious.txt",
				);
				const unpackStream = unpackTar(extractDir, { concurrency: 1 });

				// Backslashes are now normalized to forward slashes, making this a traversal attempt
				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					/points outside.*extraction directory/,
				);

				// With concurrency: 1, the safe file should be created before malicious entry causes failure
				const files = await fs.readdir(extractDir);
				expect(files).toContain("safe-file.txt");
				expect(files).toHaveLength(1);

				// Verify malicious file was NOT created
				const maliciousPath = path.resolve(tmpDir, "malicious.txt");
				await expect(fs.access(maliciousPath)).rejects.toThrow();
			},
		);
	});
});
