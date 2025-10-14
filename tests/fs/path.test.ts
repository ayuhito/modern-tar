import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	normalizeHeaderName,
	normalizeUnicode,
	validateBounds,
} from "../../src/fs/path";

describe("path utilities", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "modern-tar-path-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	describe("normalizeHeaderName", () => {
		it("applies all normalization steps in correct order", () => {
			// Test that it strips trailing slashes, normalizes Windows paths, and normalizes Unicode
			expect(normalizeHeaderName("café/")).toBe("cafe\u0301");
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

		it("handles complex paths with all normalization features", () => {
			// On Unix, backslashes are preserved as literal characters
			// Backslashes are always normalized to forward slashes for tar compatibility
			expect(normalizeHeaderName("café\\dir/")).toBe("cafe\u0301/dir");
			expect(normalizeHeaderName("测试文件///")).toBe("测试文件");
			expect(normalizeHeaderName("path/with/unicode/ñ/")).toBe(
				"path/with/unicode/n\u0303",
			);
		});

		it("is consistent between cache key and filesystem operations", () => {
			// This ensures the same normalization is used everywhere
			const testPaths = [
				"file.txt/",
				"dir\\subdir/",
				"café/",
				"path///multiple///slashes/",
				"unicode/测试/",
			];

			for (const testPath of testPaths) {
				const normalized = normalizeHeaderName(testPath);
				// Should be idempotent
				expect(normalizeHeaderName(normalized)).toBe(normalized);
				// Should not have trailing slashes
				expect(normalized.endsWith("/")).toBe(false);
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

		it("strips trailing slashes comprehensively", () => {
			// Basic cases
			expect(normalizeHeaderName("path/to/file/")).toBe("path/to/file");
			expect(normalizeHeaderName("directory/")).toBe("directory");
			expect(normalizeHeaderName("single/")).toBe("single");
			expect(normalizeHeaderName("multiple////")).toBe("multiple");

			// Cases that should remain unchanged
			expect(normalizeHeaderName("path/with/slash")).toBe("path/with/slash");
			expect(normalizeHeaderName("no-slash")).toBe("no-slash");
			expect(normalizeHeaderName("path/with/internal/slashes")).toBe(
				"path/with/internal/slashes",
			);

			// Only slashes
			expect(normalizeHeaderName("////")).toBe("");

			// Single character cases
			expect(normalizeHeaderName("a/")).toBe("a");
			expect(normalizeHeaderName("a")).toBe("a");

			// Leading slashes are stripped to convert absolute to relative paths (node-tar compatible)
			expect(normalizeHeaderName("//path//")).toBe("path");
		});

		it("handles mixed content and special characters", () => {
			// File extensions
			expect(normalizeHeaderName("file.txt/")).toBe("file.txt");
			expect(normalizeHeaderName("my-file.tar.gz/")).toBe("my-file.tar.gz");
			expect(normalizeHeaderName("special@chars#$/")).toBe("special@chars#$");

			// Paths with spaces
			expect(normalizeHeaderName("path with spaces/")).toBe("path with spaces");
			expect(normalizeHeaderName("  leading spaces/")).toBe("  leading spaces");
			expect(normalizeHeaderName("trailing spaces  /")).toBe(
				"trailing spaces  ",
			);
		});

		it("handles unicode characters with trailing slashes", () => {
			expect(normalizeHeaderName("café/")).toBe("cafe\u0301");
			expect(normalizeHeaderName("测试文件/")).toBe("测试文件");
			expect(normalizeHeaderName("файл///")).toBe("фаи\u0306л");
		});

		it("handles very long paths with trailing slashes", () => {
			const longPath = "a".repeat(1000);
			const longPathWithSlash = `${longPath}/`;
			const longPathWithSlashes = `${longPath}////`;

			expect(normalizeHeaderName(longPathWithSlash)).toBe(longPath);
			expect(normalizeHeaderName(longPathWithSlashes)).toBe(longPath);
		});

		it("handles alternating slash patterns", () => {
			expect(normalizeHeaderName("a/b/c/d/e/f/")).toBe("a/b/c/d/e/f");
			expect(normalizeHeaderName("///a///b///c///")).toBe("a///b///c");
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

	describe("normalizeUnicode", () => {
		it("normalizes unicode strings using NFD", () => {
			// Test with composed characters
			const composed = "café"; // é is a single composed character
			const decomposed = "cafe\u0301"; // e + combining acute accent

			expect(normalizeUnicode(composed)).toBe("cafe\u0301");
			expect(normalizeUnicode(decomposed)).toBe("cafe\u0301");
			expect(normalizeUnicode(composed)).toBe(normalizeUnicode(decomposed));
		});

		it("handles various unicode normalization forms", () => {
			const testCases = [
				{ input: "Å", expected: "A\u030A" }, // Å -> A + combining ring above
				{ input: "ñ", expected: "n\u0303" }, // ñ -> n + combining tilde
				{ input: "ü", expected: "u\u0308" }, // ü -> u + combining diaeresis
				{ input: "ć", expected: "c\u0301" }, // ć -> c + combining acute accent
			];

			for (const { input, expected } of testCases) {
				expect(normalizeUnicode(input)).toBe(expected);
			}
		});

		it("caches normalized results for performance", () => {
			const input = "café";
			const result1 = normalizeUnicode(input);
			const result2 = normalizeUnicode(input);

			expect(result1).toBe(result2);
			expect(result1).toBe("cafe\u0301");
		});

		it("handles cache size limits", () => {
			// Fill cache beyond limit to test pruning
			const testStrings: string[] = [];

			// Generate 11000+ unique strings to exceed MAX_CACHE_SIZE (10000)
			for (let i = 0; i < 11000; i++) {
				testStrings.push(`test${i}café`);
			}

			// Normalize all strings to fill cache
			const results = testStrings.map((s) => normalizeUnicode(s));

			// Verify normalization still works after cache pruning
			expect(results[0]).toBe("test0cafe\u0301");
			expect(results[10999]).toBe("test10999cafe\u0301");
		});

		it("handles empty strings", () => {
			expect(normalizeUnicode("")).toBe("");
		});

		it("handles ASCII-only strings", () => {
			const ascii = "hello world 123";
			expect(normalizeUnicode(ascii)).toBe(ascii);
		});

		it("handles strings with mixed unicode and ASCII", () => {
			const mixed = "hello café world";
			expect(normalizeUnicode(mixed)).toBe("hello cafe\u0301 world");
		});

		it("handles extremely long unicode strings", () => {
			const longString = "café".repeat(1000);
			const expected = "cafe\u0301".repeat(1000);
			expect(normalizeUnicode(longString)).toBe(expected);
		});

		it("handles unicode homograph attacks", () => {
			// Test strings that look similar but are different unicode characters
			const cyrillic_a = "а"; // Cyrillic small letter a (U+0430)
			const latin_a = "a"; // Latin small letter a (U+0061)

			const normalizedCyrillic = normalizeUnicode(cyrillic_a);
			const normalizedLatin = normalizeUnicode(latin_a);

			expect(normalizedCyrillic).not.toBe(normalizedLatin);
			expect(normalizedCyrillic).toBe("а"); // Should remain cyrillic
			expect(normalizedLatin).toBe("a"); // Should remain latin
		});

		it("handles zero-width characters and invisibles", () => {
			const withZeroWidth = "test\u200Bfile"; // Zero-width space
			const withRTL = "test\u202Efile"; // Right-to-left override

			expect(normalizeUnicode(withZeroWidth)).toBe("test\u200Bfile");
			expect(normalizeUnicode(withRTL)).toBe("test\u202Efile");
		});

		it("handles cache poisoning attempts", () => {
			// Attempt to poison cache with malicious normalized values
			const maliciousInputs = [
				"../evil",
				"..\\evil",
				"evil\u0000",
				"evil\uFEFF", // Byte order mark
			];

			// Normalize all malicious inputs
			const results = maliciousInputs.map((input) => normalizeUnicode(input));

			// Verify normalization doesn't create security issues
			expect(results[0]).toBe("../evil");
			expect(results[1]).toBe("..\\evil");
			expect(results[2]).toBe("evil\u0000");
			expect(results[3]).toBe("evil\uFEFF");
		});

		it("handles memory exhaustion via cache overflow", () => {
			// Test with many unique unicode strings to trigger cache pruning
			const uniqueStrings: string[] = [];

			for (let i = 0; i < 12000; i++) {
				uniqueStrings.push(`unique${i}\u0301`);
			}

			// This should trigger cache pruning without crashing
			const results = uniqueStrings.map((s) => normalizeUnicode(s));

			// Verify results are still correct after pruning
			expect(results[0]).toBe("unique0\u0301");
			expect(results[11999]).toBe("unique11999\u0301");
		});

		it("handles concurrent cache access patterns", () => {
			const testString = "concurrent\u0301";

			// Simulate concurrent access
			const promises = Array(100)
				.fill(0)
				.map(() => Promise.resolve(normalizeUnicode(testString)));

			return Promise.all(promises).then((results) => {
				// All results should be identical
				expect(results.every((r) => r === "concurrent\u0301")).toBe(true);
			});
		});
	});

	describe("validateBounds", () => {
		it("allows paths within destination directory", () => {
			const destDir = path.join(tmpDir, "extract");
			const targetPath = path.join(destDir, "file.txt");

			expect(() => {
				validateBounds(targetPath, destDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("allows exact destination directory path", () => {
			const destDir = path.join(tmpDir, "extract");

			expect(() => {
				validateBounds(destDir, destDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("prevents path traversal with relative paths", () => {
			const destDir = path.join(tmpDir, "extract");
			const targetPath = path.join(destDir, "../outside.txt");

			expect(() => {
				validateBounds(targetPath, destDir, "Path outside bounds");
			}).toThrow("Path outside bounds");
		});

		it("prevents absolute paths outside destination", () => {
			const destDir = path.join(tmpDir, "extract");
			const targetPath = "/etc/passwd";

			expect(() => {
				validateBounds(targetPath, destDir, "Path outside bounds");
			}).toThrow("Path outside bounds");
		});

		it("handles unicode normalization in path validation", () => {
			const destDir = path.join(tmpDir, "extract");
			const targetPath = path.join(destDir, "café.txt");

			expect(() => {
				validateBounds(targetPath, destDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("prevents unicode normalization bypass attacks", () => {
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

		it("handles mixed separators correctly", () => {
			const destDir = path.join(tmpDir, "extract");
			const targetPath = `${destDir}/subdir\\file.txt`;

			expect(() => {
				validateBounds(targetPath, destDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("handles sophisticated unicode path traversal", () => {
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

		it("handles deeply nested valid paths", () => {
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

		it("prevents bypassing with double encoding", () => {
			const destDir = path.join(tmpDir, "extract");
			// URL encoding won't be decoded by path.join, so this creates a valid path
			const encodedPath = path.join(destDir, "..%2F..%2Fevil.txt");

			// This should actually be valid since path.join doesn't decode URLs
			expect(() => {
				validateBounds(encodedPath, destDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("handles empty path components", () => {
			const destDir = path.join(tmpDir, "extract");
			const targetPath = path.join(destDir, "dir", "", "file.txt");

			expect(() => {
				validateBounds(targetPath, destDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("prevents case-sensitive bypass attempts", () => {
			const destDir = path.join(tmpDir, "extract");
			const targetPath = path.join(destDir, "../EXTRACT/file.txt");

			expect(() => {
				validateBounds(targetPath, destDir, "Path outside bounds");
			}).toThrow("Path outside bounds");
		});

		it("handles very long destination directories", () => {
			const longDir = path.join(tmpDir, "a".repeat(200));
			const targetPath = path.join(longDir, "file.txt");

			expect(() => {
				validateBounds(targetPath, longDir, "Path outside bounds");
			}).not.toThrow();
		});

		it("prevents subtle unicode spoofing in paths", () => {
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

		it("handles Windows-style paths on Unix systems", () => {
			const destDir = path.join(tmpDir, "extract");
			const windowsPath = `${destDir}\\subdir\\file.txt`;

			// On Unix systems, the path module normalizes this differently
			// The actual normalized path may not start with destDir + sep
			const normalizedDest = normalizeUnicode(destDir);
			const normalizedPath = normalizeUnicode(windowsPath);

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

		it("prevents directory traversal with URL encoding", () => {
			const destDir = path.join(tmpDir, "extract");
			const encodedPath = path.join(destDir, "%2e%2e%2f%2e%2e%2fevil.txt");

			// URL encoding is not decoded by path.join, so this is a valid filename
			expect(() => {
				validateBounds(encodedPath, destDir, "Path outside bounds");
			}).not.toThrow();
		});
	});
});
