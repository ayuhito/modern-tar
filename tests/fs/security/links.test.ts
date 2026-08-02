import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect } from "vitest";
import { unpackTar } from "../../../src/fs";
import { packTar, type TarEntry } from "../../../src/web";
import { it } from "../../helpers/test";
import {
	createTarWithMaliciousHardlink,
	createTarWithSymlink,
} from "./helpers";

describe("link security", () => {
	describe("hardlink path traversal", () => {
		it("prevents hardlinks with relative path traversal in target", async ({
			tmpDir,
		}) => {
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

		it("prevents hardlinks with absolute paths in target", async ({
			tmpDir,
		}) => {
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

		it("allows safe hardlinks within extraction directory", async ({
			tmpDir,
		}) => {
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

		it("preserves Unicode spelling for hardlink targets", async ({
			tmpDir,
		}) => {
			const extractDir = path.join(tmpDir, "extract");
			const targetName = "café.txt";
			const linkName = "cafe\u0301.txt";
			await fs.mkdir(extractDir, { recursive: true });

			const tarBuffer = await packTar([
				{
					header: { name: targetName, size: 5, type: "file" },
					body: "hello",
				},
				{
					header: {
						name: linkName,
						linkname: targetName,
						size: 0,
						type: "link",
					},
				},
			]);
			await pipeline(Readable.from([tarBuffer]), unpackTar(extractDir));

			const [targetStat, linkStat] = await Promise.all([
				fs.stat(path.join(extractDir, targetName)),
				fs.stat(path.join(extractDir, linkName)),
			]);
			expect(linkStat.ino).toBe(targetStat.ino);
			expect(await fs.readdir(extractDir)).toContain(targetName);
		});

		it("should skip self-referential hardlinks with various path formats", async ({
			tmpDir,
		}) => {
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

		it("should handle mixed archive with self-referential and normal hardlinks", async ({
			tmpDir,
		}) => {
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
					},
				},
				{
					header: {
						name: "self-link.txt",
						size: 0,
						type: "link",
						linkname: "self-link.txt", // Self-referential
						mode: 0o644,
					},
				},
			];

			const tarBuffer = await packTar(entries);
			const tarStream = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			await expect(pipeline(tarStream, unpackStream)).resolves.toBeUndefined();

			// Verify that only the original file and valid hardlink were created
			const files = (await fs.readdir(extractDir)).sort();
			expect(files).toEqual(["original.txt", "valid-link.txt"]);

			// Verify the valid hardlink works correctly
			const originalStat = await fs.stat(path.join(extractDir, "original.txt"));
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
	describe("symlink traversal prevention", () => {
		const symlinkEntry = (name: string, linkname: string): TarEntry => ({
			header: {
				name,
				size: 0,
				type: "symlink",
				linkname,
			},
		});

		it.skipIf(process.platform === "win32")(
			"prevents symlinks pointing outside extraction directory",
			async ({ tmpDir }) => {
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
			async ({ tmpDir }) => {
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
			"prevents symlink graphs that resolve outside extraction directory",
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const entries: TarEntry[] = [
					symlinkEntry("root", "noop/.."),
					symlinkEntry("noop", "."),
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					'Symlink "noop/.." points outside the extraction directory.',
				);

				await expect(fs.lstat(path.join(extractDir, "root"))).rejects.toThrow();
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents pre-existing symlink components from escaping the extraction directory",
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.symlink(".", path.join(extractDir, "noop"));

				const maliciousTar = await createTarWithSymlink("noop/..");
				await expect(
					pipeline(maliciousTar, unpackTar(extractDir)),
				).rejects.toThrow(
					'Symlink "noop/.." points outside the extraction directory.',
				);

				await expect(
					fs.lstat(path.join(extractDir, "malicious-symlink")),
				).rejects.toThrow();
			},
		);

		it.skipIf(process.platform === "win32")(
			"invalidates cached directories after replacing a symlink",
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				const outsidePath = path.join(tmpDir, "escaped.txt");
				await fs.mkdir(path.join(extractDir, "safe"), { recursive: true });
				await fs.symlink("safe", path.join(extractDir, "cached"));
				await fs.symlink(".", path.join(extractDir, "redirect"));

				const tarBuffer = await packTar([
					{
						header: { name: "cached/inside.txt", size: 4, type: "file" },
						body: "safe",
					},
					symlinkEntry("cached", "redirect/.."),
					{
						header: { name: "cached/escaped.txt", size: 5, type: "file" },
						body: "pwned",
					},
				]);

				await expect(
					pipeline(Readable.from([tarBuffer]), unpackTar(extractDir)),
				).rejects.toThrow("points outside the extraction directory");
				expect(
					await fs.readFile(
						path.join(extractDir, "safe", "inside.txt"),
						"utf8",
					),
				).toBe("safe");
				await expect(fs.lstat(outsidePath)).rejects.toThrow();
			},
		);

		it.skipIf(process.platform === "win32")(
			"rejects dangling escapes through pre-existing symlinks",
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.symlink(
					"../outside/missing",
					path.join(extractDir, "redirect"),
				);

				const tarBuffer = await packTar([symlinkEntry("root", "redirect")]);
				await expect(
					pipeline(Readable.from([tarBuffer]), unpackTar(extractDir)),
				).rejects.toThrow(
					'Symlink "redirect" points outside the extraction directory.',
				);
				await expect(fs.lstat(path.join(extractDir, "root"))).rejects.toThrow();
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents pre-existing symlinks from redirecting targets outside the extraction directory",
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				const outsideDir = path.join(tmpDir, "outside");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.mkdir(outsideDir);
				await fs.symlink(outsideDir, path.join(extractDir, "redirect"));

				const maliciousTar = await createTarWithSymlink("redirect");
				await expect(
					pipeline(maliciousTar, unpackTar(extractDir)),
				).rejects.toThrow(
					'Symlink "redirect" points outside the extraction directory.',
				);

				await expect(
					fs.lstat(path.join(extractDir, "malicious-symlink")),
				).rejects.toThrow();
			},
		);

		it.skipIf(process.platform === "win32")(
			"rejects canonical sibling paths that share the destination prefix",
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				const siblingDir = path.join(tmpDir, "extract-sibling");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.mkdir(siblingDir);
				await fs.writeFile(path.join(siblingDir, "target.txt"), "outside");
				await fs.symlink(
					"../extract-sibling",
					path.join(extractDir, "redirect"),
				);

				const tarBuffer = await packTar([
					symlinkEntry("root", "redirect/target.txt"),
				]);
				await expect(
					pipeline(Readable.from([tarBuffer]), unpackTar(extractDir)),
				).rejects.toThrow(
					'Symlink "redirect/target.txt" points outside the extraction directory.',
				);
				await expect(fs.lstat(path.join(extractDir, "root"))).rejects.toThrow();
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents repeated symlink graph rewrites from escaping",
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const linkname = `${"noop/".repeat(8)}${"../".repeat(8)}`;
				const entries: TarEntry[] = [
					symlinkEntry("root", linkname),
					symlinkEntry("noop", "."),
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					`Symlink "${linkname}" points outside the extraction directory.`,
				);

				await expect(fs.lstat(path.join(extractDir, "root"))).rejects.toThrow();
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents absolute symlink graphs that resolve outside extraction directory",
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const absoluteLinkname = `${extractDir}/noop/..`;
				const entries: TarEntry[] = [
					symlinkEntry("root", absoluteLinkname),
					symlinkEntry("noop", "."),
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
					`Symlink "${absoluteLinkname}" points outside the extraction directory.`,
				);

				await expect(fs.lstat(path.join(extractDir, "root"))).rejects.toThrow();
			},
		);

		it.skipIf(process.platform === "win32")(
			"does not treat backslashes as path separators on POSIX",
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const entries: TarEntry[] = [
					symlinkEntry("root", "noop\\.."),
					symlinkEntry("noop", "."),
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				await pipeline(maliciousTar, unpackStream);

				await expect(fs.readlink(path.join(extractDir, "root"))).resolves.toBe(
					"noop\\..",
				);
			},
		);

		it.skipIf(process.platform === "win32")(
			"allows safe symlinks within extraction directory",
			async ({ tmpDir }) => {
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
			async ({ tmpDir }) => {
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
			async ({ tmpDir }) => {
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
			async ({ tmpDir }) => {
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
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const entries: TarEntry[] = [
					{
						header: {
							name: "nested/",
							size: 0,
							type: "directory",
							mode: 0o755,
						},
					},
					{
						header: {
							name: "nested/malicious-symlink",
							size: 0,
							type: "symlink",
							mode: 0o644,
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
			async ({ tmpDir }) => {
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
			async ({ tmpDir }) => {
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
	});
	it.skipIf(process.platform === "win32")(
		"prevents symlink to parent followed by file creation attack",
		async ({ tmpDir }) => {
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
						linkname: "../",
					},
				},
				{
					header: {
						name: "escape-dir/malicious-file.txt",
						size: 15,
						type: "file",
						mode: 0o644,
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
		async ({ tmpDir }) => {
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
						linkname: "level2",
					},
				},
				{
					header: {
						name: "level2",
						size: 0,
						type: "symlink",
						mode: 0o777,
						linkname: "level3",
					},
				},
				{
					header: {
						name: "level3",
						size: 0,
						type: "symlink",
						mode: 0o777,
						linkname: "../../",
					},
				},
				{
					header: {
						name: "level1/malicious.txt",
						size: 18,
						type: "file",
						mode: 0o644,
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
});
