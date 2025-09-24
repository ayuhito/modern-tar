import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { TarEntry } from "@modern-tar/core";
import { packTar } from "@modern-tar/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unpackTar } from "../src/index";

describe("symlink traversal", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "modern-tar-security-test-"),
		);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

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

	it.skipIf(process.platform === "win32")(
		"prevents symlinks pointing outside extraction directory",
		async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a malicious tar with symlink pointing to parent directory
			const maliciousTar = await createTarWithSymlink("../../etc/passwd");
			const unpackStream = unpackTar(extractDir);

			// This should throw an error
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				'Symlink target "../../etc/passwd" points outside of the extraction directory.',
			);
		},
	);

	it.skipIf(process.platform === "win32")(
		"prevents symlinks with absolute paths outside extraction directory",
		async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a malicious tar with absolute path symlink
			const maliciousTar = await createTarWithSymlink("/etc/passwd");
			const unpackStream = unpackTar(extractDir);

			// This should throw an error
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				'Symlink target "/etc/passwd" points outside of the extraction directory.',
			);
		},
	);

	it.skipIf(process.platform === "win32")(
		"allows safe symlinks within extraction directory",
		async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a safe tar with symlink pointing within extraction directory
			const safeTar = await createTarWithSymlink("safe-file.txt");
			const unpackStream = unpackTar(extractDir);

			// This should succeed
			await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

			// Verify the symlink was created correctly
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

			// Create a safe tar with symlink pointing to subdirectory
			const safeTar = await createTarWithSymlink("subdir/file.txt");
			const unpackStream = unpackTar(extractDir);

			// This should succeed
			await expect(pipeline(safeTar, unpackStream)).resolves.toBeUndefined();

			// Verify the symlink was created correctly
			const symlinkPath = path.join(extractDir, "malicious-symlink");
			const linkStat = await fs.lstat(symlinkPath);
			expect(linkStat.isSymbolicLink()).toBe(true);

			const linkTarget = await fs.readlink(symlinkPath);
			expect(linkTarget).toBe("subdir/file.txt");
		},
	);

	it.skipIf(process.platform === "win32")(
		"allows bypassing symlink validation when disabled",
		async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a malicious tar with symlink pointing outside
			const maliciousTar = await createTarWithSymlink("../outside-file.txt");
			const unpackStream = unpackTar(extractDir, { validateSymlinks: false });

			// This should succeed when validation is disabled
			await expect(
				pipeline(maliciousTar, unpackStream),
			).resolves.toBeUndefined();

			// Verify the symlink was created (even though it's potentially unsafe)
			const symlinkPath = path.join(extractDir, "malicious-symlink");
			const linkStat = await fs.lstat(symlinkPath);
			expect(linkStat.isSymbolicLink()).toBe(true);

			const linkTarget = await fs.readlink(symlinkPath);
			expect(linkTarget).toBe("../outside-file.txt");
		},
	);

	it.skipIf(process.platform === "win32")(
		"validates symlinks with complex relative paths",
		async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a complex but safe relative path that stays within bounds
			const safeTar = await createTarWithSymlink("./subdir/../safe-file.txt");
			const unpackStream = unpackTar(extractDir);

			// This should succeed as the resolved path is within the extraction directory
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

			// Try a clever traversal that goes up and then tries to come back
			const maliciousTar = await createTarWithSymlink("../../../tmp/malicious");
			const unpackStream = unpackTar(extractDir);

			// This should throw an error
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				"points outside of the extraction directory",
			);
		},
	);

	it.skipIf(process.platform === "win32")(
		"validates symlinks in nested directories",
		async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create entries for nested structure with malicious symlink
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

			// This should throw an error even for nested symlinks
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				"points outside of the extraction directory",
			);
		},
	);

	it.skipIf(process.platform === "win32")(
		"allows symlinks to the extraction directory root",
		async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a symlink that points to the extraction directory itself
			const safeTar = await createTarWithSymlink(".");
			const unpackStream = unpackTar(extractDir);

			// This should succeed as "." resolves to the extraction directory
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

			// Create a symlink with multiple levels that eventually goes outside
			const maliciousTar = await createTarWithSymlink(
				"./foo/../bar/../../etc/passwd",
			);
			const unpackStream = unpackTar(extractDir);

			// This should throw an error as the resolved path goes outside
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				"points outside of the extraction directory",
			);
		},
	);

	it.skipIf(process.platform === "win32")(
		"validates symlinks by default (validateSymlinks: true is the default)",
		async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			// Create a malicious tar with symlink pointing outside
			const maliciousTar = await createTarWithSymlink("../../etc/passwd");
			// Don't specify validateSymlinks - should default to true
			const unpackStream = unpackTar(extractDir);

			// This should throw an error since validation is enabled by default
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				'Symlink target "../../etc/passwd" points outside of the extraction directory.',
			);
		},
	);
});
