import * as path from "node:path";
import { describe, expect } from "vitest";
import { normalizeHeaderName, validateBounds } from "../../src/fs/path";
import { it } from "../helpers/test";

describe("path utilities", () => {
	describe("normalizeHeaderName", () => {
		it("preserves Unicode while normalizing path syntax", () => {
			expect(normalizeHeaderName("café/")).toBe("café");
			// Backslashes are always normalized to forward slashes for tar compatibility
			expect(normalizeHeaderName("path\\to\\file/")).toBe("path/to/file");
			expect(normalizeHeaderName("test///")).toBe("test");
		});

		it("handles Windows drive letters and reserved characters on Windows", () => {
			// Mock Windows platform
			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });

			try {
				expect(normalizeHeaderName("C:file.txt/")).toBe("file.txt");
				expect(normalizeHeaderName("path<>file/")).toBe("path\uF03C\uF03Efile");
				expect(normalizeHeaderName("file|name/")).toBe("file\uF07Cname");
			} finally {
				// Restore original platform
				Object.defineProperty(process, "platform", { value: originalPlatform });
			}
		});

		it("handles edge cases", () => {
			expect(normalizeHeaderName("")).toBe("");
			expect(normalizeHeaderName("/")).toBe("");
			expect(normalizeHeaderName("///")).toBe("");
			expect(normalizeHeaderName("file")).toBe("file");
		});

		it("handles security-relevant paths consistently", () => {
			// Conservative security approach - reject any traversal patterns including bare ".."
			expect(() => normalizeHeaderName("../")).toThrow(
				".. points outside extraction directory",
			);
			expect(() => normalizeHeaderName("../../")).toThrow(
				"../.. points outside extraction directory",
			);
			expect(normalizeHeaderName("./")).toBe(".");
			expect(normalizeHeaderName("~/")).toBe("~");
		});

		it("rejects trailing .. traversal attempts (node-tar compatibility)", () => {
			// Segment-based detection catches .. anywhere in the path
			expect(() => normalizeHeaderName("foo/bar/..")).toThrow(
				"foo/bar/.. points outside extraction directory",
			);
			expect(() => normalizeHeaderName("safe/path/..")).toThrow(
				"safe/path/.. points outside extraction directory",
			);
			expect(() => normalizeHeaderName("a/b/c/..")).toThrow(
				"a/b/c/.. points outside extraction directory",
			);
			expect(() => normalizeHeaderName("dir/..")).toThrow(
				"dir/.. points outside extraction directory",
			);
		});

		it("handles very long paths with trailing slashes", () => {
			const longPath = "a".repeat(1000);
			const longPathWithSlash = `${longPath}/`;
			const longPathWithSlashes = `${longPath}////`;

			expect(normalizeHeaderName(longPathWithSlash)).toBe(longPath);
			expect(normalizeHeaderName(longPathWithSlashes)).toBe(longPath);
		});

		it("converts absolute paths to relative paths for node-tar compatibility", () => {
			// Single leading slash
			expect(normalizeHeaderName("/tmp/file.txt")).toBe("tmp/file.txt");
			expect(normalizeHeaderName("/usr/local/bin/app")).toBe(
				"usr/local/bin/app",
			);

			// Multiple leading slashes
			expect(normalizeHeaderName("//network/share/file")).toBe(
				"network/share/file",
			);
			expect(normalizeHeaderName("///root/config/")).toBe("root/config");

			// Complex absolute paths with trailing slashes
			expect(normalizeHeaderName("/home/user/documents/")).toBe(
				"home/user/documents",
			);
			expect(normalizeHeaderName("////var/log/app.log")).toBe(
				"var/log/app.log",
			);

			// Edge cases
			expect(normalizeHeaderName("/")).toBe("");
			expect(normalizeHeaderName("//")).toBe("");
			expect(normalizeHeaderName("///")).toBe("");
		});
	});

	describe("validateBounds", () => {
		it("allows paths within destination directory", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");
			const targetPath = path.join(destDir, "file.txt");

			expect(() => {
				validateBounds(targetPath, destDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("allows exact destination directory path", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");

			expect(() => {
				validateBounds(destDir, destDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("prevents path traversal with relative paths", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");
			const targetPath = path.join(destDir, "../outside.txt");

			expect(() => {
				validateBounds(targetPath, destDir, "Path outside bounds");
			}).toThrow("Path outside bounds");
		});

		it("prevents absolute paths outside destination", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");
			const targetPath = "/etc/passwd";

			expect(() => {
				validateBounds(targetPath, destDir, "Path outside bounds");
			}).toThrow("Path outside bounds");
		});

		it("handles unicode normalization in path validation", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");
			const targetPath = path.join(destDir, "café.txt");

			expect(() => {
				validateBounds(targetPath, destDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("prevents unicode normalization bypass attacks", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");

			// Test with different unicode normalization forms of the same characters
			const composed = path.join(destDir, "../café");
			const decomposed = path.join(destDir, "../cafe\u0301");

			expect(() => {
				validateBounds(composed, destDir, "Path outside bounds");
			}).toThrow("Path outside bounds");

			expect(() => {
				validateBounds(decomposed, destDir, "Path outside bounds");
			}).toThrow("Path outside bounds");
		});

		it("does not conflate Unicode-equivalent sibling directories", ({
			tmpDir,
		}) => {
			const destDir = path.join(tmpDir, "café");
			const siblingPath = path.join(tmpDir, "cafe\u0301", "outside.txt");

			expect(() => {
				validateBounds(siblingPath, destDir, "Path outside bounds");
			}).toThrow("Path outside bounds");
		});

		it("handles mixed separators correctly", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");
			const targetPath = `${destDir}/subdir\\file.txt`;

			expect(() => {
				validateBounds(targetPath, destDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("handles sophisticated unicode path traversal", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");

			// Test with various unicode characters that could be used in attacks
			const attacks = [
				path.resolve(destDir, "..\u002F.."), // Unicode slash
				path.resolve(destDir, "..\uFF0F.."), // Fullwidth solidus
				path.resolve(destDir, "..\u2215.."), // Division slash
				path.resolve(destDir, "../\u0000../evil"), // Null byte
			];

			for (const attack of attacks) {
				// These should all resolve to paths outside destDir
				if (!attack.startsWith(destDir + path.sep) && attack !== destDir) {
					expect(() => {
						validateBounds(attack, destDir, "Path outside bounds");
					}).toThrow("Path outside bounds");
				}
			}
		});

		it("handles deeply nested valid paths", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");
			const deepPath = path.join(
				destDir,
				...Array(50).fill("level"),
				"file.txt",
			);

			expect(() => {
				validateBounds(deepPath, destDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("prevents bypassing with double encoding", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");
			// URL encoding won't be decoded by path.join, so this creates a valid path
			const encodedPath = path.join(destDir, "..%2F..%2Fevil.txt");

			// This should actually be valid since path.join doesn't decode URLs
			expect(() => {
				validateBounds(encodedPath, destDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("handles empty path components", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");
			const targetPath = path.join(destDir, "dir", "", "file.txt");

			expect(() => {
				validateBounds(targetPath, destDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("prevents case-sensitive bypass attempts", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");
			const targetPath = path.join(destDir, "../EXTRACT/file.txt");

			expect(() => {
				validateBounds(targetPath, destDir, "Path outside bounds");
			}).toThrow("Path outside bounds");
		});

		it("handles very long destination directories", ({ tmpDir }) => {
			const longDir = path.join(tmpDir, "a".repeat(200));
			const targetPath = path.join(longDir, "file.txt");

			expect(() => {
				validateBounds(targetPath, longDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("prevents subtle unicode spoofing in paths", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");

			// Test with look-alike characters that could confuse path validation
			const spoofed = path.resolve(destDir, "..\u002E/evil.txt"); // Unicode full stop

			// Check if this actually resolves outside the directory
			if (!spoofed.startsWith(destDir + path.sep) && spoofed !== destDir) {
				expect(() => {
					validateBounds(spoofed, destDir, "Path outside bounds");
				}).toThrow("Path outside bounds");
			} else {
				expect(() => {
					validateBounds(spoofed, destDir, "Path outside bounds");
				}).not.toThrow();
			}
		});

		it("handles Windows-style paths on Unix systems", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");
			const windowsPath = `${destDir}\\subdir\\file.txt`;

			// On Unix systems, the path module normalizes this differently
			// The actual normalized path may not start with destDir + sep
			const normalizedDest = path.resolve(destDir);
			const normalizedPath = path.resolve(windowsPath);

			if (
				normalizedPath.startsWith(normalizedDest + path.sep) ||
				normalizedPath === normalizedDest
			) {
				expect(() => {
					validateBounds(windowsPath, destDir, "Path outside bounds");
				}).not.toThrow();
			} else {
				expect(() => {
					validateBounds(windowsPath, destDir, "Path outside bounds");
				}).toThrow("Path outside bounds");
			}
		});

		it("prevents directory traversal with URL encoding", ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extract");
			const encodedPath = path.join(destDir, "%2e%2e%2f%2e%2e%2fevil.txt");

			// URL encoding is not decoded by path.join, so this is a valid filename
			expect(() => {
				validateBounds(encodedPath, destDir, "Path outside bounds");
			}).not.toThrow();
		});
	});
});
