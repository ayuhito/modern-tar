import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect } from "vitest";
import { unpackTar } from "../../../src/fs";
import { packTar, type TarEntry } from "../../../src/web";
import { it } from "../../helpers/test";
import { archiveWithHardlink } from "./helpers";

describe("CVE regressions", () => {
	describe("CVE-specific attacks", () => {
		it.skipIf(process.platform === "win32")(
			"prevents tar-fs symlink traversal vulnerability (CVE-2025-59343)",
			async ({ tmpDir }) => {
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
			async ({ tmpDir }) => {
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
			"rejects leaf symlink hardlink targets without deleting external targets",
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				const outsideDir = path.join(tmpDir, "outside");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.mkdir(outsideDir, { recursive: true });

				const victimFile = path.join(outsideDir, "victim.txt");
				const prelink = path.join(extractDir, "prelink");
				await fs.writeFile(victimFile, "do not delete");
				await fs.symlink(victimFile, prelink);

				const maliciousTar = await archiveWithHardlink("link.txt", "prelink");

				await expect(
					pipeline(maliciousTar, unpackTar(extractDir)),
				).rejects.toThrow();
				await expect(fs.readFile(victimFile, "utf8")).resolves.toBe(
					"do not delete",
				);
				await expect(
					fs.lstat(path.join(extractDir, "link.txt")),
				).rejects.toThrow();
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents CVE-2025-48387 multi-stage symlink+hardlink attack",
			async ({ tmpDir }) => {
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
			async ({ tmpDir }) => {
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
			async ({ tmpDir }) => {
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
			async ({ tmpDir }) => {
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
			async ({ tmpDir }) => {
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
			async ({ tmpDir }) => {
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
	});
});
