import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { arrayBuffer } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import { describe, expect } from "vitest";
import {
	packTar as packTarFS,
	type TarSource,
	unpackTar,
} from "../../../src/fs";
import { it } from "../../helpers/test";

describe("dereference containment", () => {
	describe("pack security vulnerabilities", () => {
		it.skipIf(process.platform === "win32")(
			"prevents symlink directory traversal during packing with dereference: true",
			async ({ tmpDir }) => {
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
				const tarBuffer = new Uint8Array(await arrayBuffer(packStream));

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
			async ({ tmpDir }) => {
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
				const tarBuffer = new Uint8Array(await arrayBuffer(packStream));

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
			async ({ tmpDir }) => {
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
				const tarBuffer = new Uint8Array(await arrayBuffer(packStream));

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
			async ({ tmpDir }) => {
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
				const tarBuffer = new Uint8Array(await arrayBuffer(packStream));

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
			async ({ tmpDir }) => {
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
				const tarBuffer = new Uint8Array(await arrayBuffer(packStream));

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
	});
});
