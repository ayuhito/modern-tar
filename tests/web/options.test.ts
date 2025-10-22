import { describe, expect, it } from "vitest";
import { decoder } from "../../src/tar/utils";
import { packTar, unpackTar } from "../../src/web";

describe("unpack options", () => {
	// Helper function to create test archive
	async function createTestArchive() {
		return await packTar([
			{
				header: {
					name: "root/level1/file1.txt",
					size: 10,
					type: "file",
					mode: 0o644,
				},
				body: "content-1\n",
			},
			{
				header: {
					name: "root/level1/file2.js",
					size: 10,
					type: "file",
					mode: 0o755,
				},
				body: "content-2\n",
			},
			{
				header: {
					name: "root/level1/subdir/",
					type: "directory",
					size: 0,
					mode: 0o755,
				},
			},
			{
				header: {
					name: "root/level1/subdir/nested.json",
					size: 10,
					type: "file",
					mode: 0o600,
				},
				body: "content-3\n",
			},
			{
				header: {
					name: "root/other/ignore.tmp",
					size: 10,
					type: "file",
					mode: 0o644,
				},
				body: "content-4\n",
			},
		]);
	}

	describe("strip option", () => {
		it("strips one path component", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, { strip: 1 });

			expect(entries).toHaveLength(5);
			expect(entries[0].header.name).toBe("level1/file1.txt");
			expect(entries[1].header.name).toBe("level1/file2.js");
			expect(entries[2].header.name).toBe("level1/subdir/");
			expect(entries[3].header.name).toBe("level1/subdir/nested.json");
			expect(entries[4].header.name).toBe("other/ignore.tmp");
		});

		it("strips two path components", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, { strip: 2 });

			expect(entries).toHaveLength(5);
			expect(entries[0].header.name).toBe("file1.txt");
			expect(entries[1].header.name).toBe("file2.js");
			expect(entries[2].header.name).toBe("subdir/");
			expect(entries[3].header.name).toBe("subdir/nested.json");
			expect(entries[4].header.name).toBe("ignore.tmp");
		});

		it("strips excessive path components", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, { strip: 10 });

			expect(entries).toHaveLength(0); // All entries become empty and are filtered out
		});

		it("handles strip with no effect", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, { strip: 0 });

			expect(entries).toHaveLength(5);
			expect(entries[0].header.name).toBe("root/level1/file1.txt");
		});

		it("strips and preserves directory structure", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, { strip: 1 });

			const dirEntry = entries.find((e) => e.header.type === "directory");
			expect(dirEntry?.header.name).toBe("level1/subdir/");
		});

		describe("symlink and hardlink handling", () => {
			it("preserves relative symlinks unchanged", async () => {
				const archive = await packTar([
					{
						header: {
							name: "parent/subdir/mylink",
							size: 0,
							type: "symlink",
							linkname: "target.txt", // relative symlink
						},
					},
					{
						header: {
							name: "parent/subdir/target.txt",
							size: 4,
							type: "file",
						},
						body: "test",
					},
				]);

				const entries = await unpackTar(archive, { strip: 1 });

				expect(entries).toHaveLength(2);
				const symlinkEntry = entries.find((e) => e.header.type === "symlink");
				expect(symlinkEntry?.header.name).toBe("subdir/mylink");
				expect(symlinkEntry?.header.linkname).toBe("target.txt"); // unchanged
			});

			it("strips absolute symlinks correctly", async () => {
				const archive = await packTar([
					{
						header: {
							name: "parent/subdir/mylink",
							size: 0,
							type: "symlink",
							linkname: "/parent/subdir/target.txt", // absolute symlink
						},
					},
					{
						header: {
							name: "parent/subdir/target.txt",
							size: 4,
							type: "file",
						},
						body: "test",
					},
				]);

				const entries = await unpackTar(archive, { strip: 1 });

				expect(entries).toHaveLength(2);
				const symlinkEntry = entries.find((e) => e.header.type === "symlink");
				expect(symlinkEntry?.header.name).toBe("subdir/mylink");
				expect(symlinkEntry?.header.linkname).toBe("/subdir/target.txt"); // stripped
			});

			it("preserves relative hardlinks unchanged", async () => {
				const archive = await packTar([
					{
						header: {
							name: "parent/subdir/mylink",
							size: 0,
							type: "link",
							linkname: "target.txt", // relative hardlink
						},
					},
					{
						header: {
							name: "parent/subdir/target.txt",
							size: 4,
							type: "file",
						},
						body: "test",
					},
				]);

				const entries = await unpackTar(archive, { strip: 1 });

				expect(entries).toHaveLength(2);
				const hardlinkEntry = entries.find((e) => e.header.type === "link");
				expect(hardlinkEntry?.header.name).toBe("subdir/mylink");
				expect(hardlinkEntry?.header.linkname).toBe("target.txt"); // unchanged
			});

			it("strips absolute hardlinks correctly", async () => {
				const archive = await packTar([
					{
						header: {
							name: "parent/subdir/mylink",
							size: 0,
							type: "link",
							linkname: "/parent/subdir/target.txt", // absolute hardlink
						},
					},
					{
						header: {
							name: "parent/subdir/target.txt",
							size: 4,
							type: "file",
						},
						body: "test",
					},
				]);

				const entries = await unpackTar(archive, { strip: 1 });

				expect(entries).toHaveLength(2);
				const hardlinkEntry = entries.find((e) => e.header.type === "link");
				expect(hardlinkEntry?.header.name).toBe("subdir/mylink");
				expect(hardlinkEntry?.header.linkname).toBe("/subdir/target.txt"); // stripped
			});

			it("skips entries when absolute linkname becomes empty after excessive strip", async () => {
				const archive = await packTar([
					{
						header: {
							name: "parent/subdir/mylink",
							size: 0,
							type: "symlink",
							linkname: "/parent/target.txt", // absolute symlink with 2 components
						},
					},
				]);

				const entries = await unpackTar(archive, { strip: 3 }); // strip more than linkname has

				expect(entries).toHaveLength(0); // entry should be filtered out
			});

			it("handles complex relative symlinks with dots", async () => {
				const archive = await packTar([
					{
						header: {
							name: "parent/subdir/mylink",
							size: 0,
							type: "symlink",
							linkname: "../other/target.txt", // relative symlink with ..
						},
					},
				]);

				const entries = await unpackTar(archive, { strip: 1 });

				expect(entries).toHaveLength(1);
				const symlinkEntry = entries[0];
				expect(symlinkEntry.header.name).toBe("subdir/mylink");
				expect(symlinkEntry.header.linkname).toBe("../other/target.txt"); // unchanged
			});
		});
	});

	describe("strip option edge cases", () => {
		describe("mixed path depths", () => {
			it("handles entries with different path component counts", async () => {
				const archive = await packTar([
					{
						header: { name: "root.txt", size: 4, type: "file" },
						body: "root",
					},
					{
						header: { name: "level1/file.txt", size: 6, type: "file" },
						body: "level1",
					},
					{
						header: { name: "level1/level2/deep.txt", size: 4, type: "file" },
						body: "deep",
					},
					{
						header: {
							name: "level1/level2/level3/deeper.txt",
							size: 6,
							type: "file",
						},
						body: "deeper",
					},
				]);

				const entries = await unpackTar(archive, { strip: 1 });

				// After strip: 1
				// "root.txt" → filtered out (no components to strip)
				// "level1/file.txt" → "file.txt"
				// "level1/level2/deep.txt" → "level2/deep.txt"
				// "level1/level2/level3/deeper.txt" → "level2/level3/deeper.txt"

				expect(entries).toHaveLength(3);

				const names = entries.map((e) => e.header.name).sort();
				expect(names).toEqual([
					"file.txt",
					"level2/deep.txt",
					"level2/level3/deeper.txt",
				]);

				// Verify content is preserved
				const fileEntry = entries.find((e) => e.header.name === "file.txt");
				expect(decoder.decode(fileEntry?.data)).toBe("level1");
			});

			it("strips multiple levels with mixed depths", async () => {
				const archive = await packTar([
					{
						header: { name: "a/b/file1.txt", size: 5, type: "file" },
						body: "file1",
					},
					{
						header: { name: "a/b/c/file2.txt", size: 5, type: "file" },
						body: "file2",
					},
					{
						header: { name: "a/b/c/d/file3.txt", size: 5, type: "file" },
						body: "file3",
					},
				]);

				const entries = await unpackTar(archive, { strip: 2 });

				// After strip: 2
				// "a/b/file1.txt" → "file1.txt"
				// "a/b/c/file2.txt" → "c/file2.txt"
				// "a/b/c/d/file3.txt" → "c/d/file3.txt"

				expect(entries).toHaveLength(3);

				const names = entries.map((e) => e.header.name).sort();
				expect(names).toEqual(["c/d/file3.txt", "c/file2.txt", "file1.txt"]);
			});

			it("filters out entries that become empty after excessive strip", async () => {
				const archive = await packTar([
					{
						header: { name: "single.txt", size: 6, type: "file" },
						body: "single",
					},
					{
						header: { name: "a/double.txt", size: 6, type: "file" },
						body: "double",
					},
					{
						header: { name: "a/b/c/triple.txt", size: 6, type: "file" },
						body: "triple",
					},
				]);

				const entries = await unpackTar(archive, { strip: 2 });

				// After strip: 2
				// "single.txt" → filtered out (becomes empty)
				// "a/double.txt" → filtered out (becomes empty)
				// "a/b/c/triple.txt" → "c/triple.txt"

				expect(entries).toHaveLength(1);
				expect(entries[0].header.name).toBe("c/triple.txt");
				expect(decoder.decode(entries[0].data)).toBe("triple");
			});
		});

		describe("directory handling", () => {
			it("strips directory entries correctly", async () => {
				const archive = await packTar([
					{
						header: { name: "root/", type: "directory", size: 0 },
					},
					{
						header: { name: "root/sub/", type: "directory", size: 0 },
					},
					{
						header: { name: "root/sub/deep/", type: "directory", size: 0 },
					},
					{
						header: { name: "root/sub/file.txt", size: 4, type: "file" },
						body: "test",
					},
				]);

				const entries = await unpackTar(archive, { strip: 1 });

				// After strip: 1
				// "root/" → filtered out (becomes empty)
				// "root/sub/" → "sub/"
				// "root/sub/deep/" → "sub/deep/"
				// "root/sub/file.txt" → "sub/file.txt"

				expect(entries).toHaveLength(3);

				const names = entries.map((e) => e.header.name).sort();
				expect(names).toEqual(["sub/", "sub/deep/", "sub/file.txt"]);

				// Check types are preserved
				const dirEntries = entries.filter((e) => e.header.type === "directory");
				expect(dirEntries).toHaveLength(2);
			});

			it("handles trailing slashes consistently", async () => {
				const archive = await packTar([
					{
						header: { name: "path/to/dir", type: "directory", size: 0 }, // No trailing slash
					},
					{
						header: { name: "path/to/other/", type: "directory", size: 0 }, // With trailing slash
					},
				]);

				const entries = await unpackTar(archive, { strip: 1 });

				expect(entries).toHaveLength(2);

				const names = entries.map((e) => e.header.name).sort();
				expect(names).toEqual(["to/dir/", "to/other/"]);
			});
		});

		describe("root directory handling", () => {
			it("handles current directory entry", async () => {
				const archive = await packTar([
					{
						header: { name: "./", type: "directory", size: 0 },
					},
					{
						header: { name: "file.txt", size: 4, type: "file" },
						body: "test",
					},
				]);

				const entries = await unpackTar(archive, { strip: 1 });

				// After strip: 1
				// "./" → filtered out (becomes empty)
				// "file.txt" → filtered out (no components to strip)

				expect(entries).toHaveLength(0);
			});

			it("handles relative paths with dots", async () => {
				const archive = await packTar([
					{
						header: { name: "./file.txt", size: 4, type: "file" },
						body: "test",
					},
					{
						header: { name: "./sub/nested.txt", size: 6, type: "file" },
						body: "nested",
					},
				]);

				const entries = await unpackTar(archive, { strip: 1 });

				// After strip: 1
				// "./file.txt" → "file.txt"
				// "./sub/nested.txt" → "sub/nested.txt"

				expect(entries).toHaveLength(2);

				const names = entries.map((e) => e.header.name).sort();
				expect(names).toEqual(["file.txt", "sub/nested.txt"]);
			});
		});

		describe("special path cases", () => {
			it("handles paths with multiple consecutive slashes", async () => {
				const archive = await packTar([
					{
						header: { name: "path//to//file.txt", size: 4, type: "file" },
						body: "test",
					},
				]);

				const entries = await unpackTar(archive, { strip: 1 });

				// "path//to//file.txt" → ["path", "to", "file.txt"] → strip 1 → ["to", "file.txt"] → "to/file.txt"
				expect(entries).toHaveLength(1);
				expect(entries[0].header.name).toBe("to/file.txt");
			});

			it("handles empty path components", async () => {
				const archive = await packTar([
					{
						header: { name: "a//b/file1.txt", size: 4, type: "file" },
						body: "test",
					},
					{
						header: { name: "x/y//file2.txt", size: 5, type: "file" },
						body: "test2",
					},
				]);

				const entries = await unpackTar(archive, { strip: 1 });

				// "a//b/file1.txt" → ["a", "b", "file1.txt"] → strip 1 → ["b", "file1.txt"] → "b/file1.txt"
				// "x/y//file2.txt" → ["x", "y", "file2.txt"] → strip 1 → ["y", "file2.txt"] → "y/file2.txt"
				expect(entries).toHaveLength(2);

				const names = entries.map((e) => e.header.name).sort();
				expect(names).toEqual(["b/file1.txt", "y/file2.txt"]);
			});

			it("handles very long paths with many components", async () => {
				const longPath = Array.from({ length: 20 }, (_, i) => `level${i}`).join(
					"/",
				);
				const archive = await packTar([
					{
						header: { name: `${longPath}/file.txt`, size: 4, type: "file" },
						body: "test",
					},
				]);

				const entries = await unpackTar(archive, { strip: 10 });

				expect(entries).toHaveLength(1);

				// After stripping 10 components, should have 10 remaining + file
				const expectedPath =
					Array.from({ length: 10 }, (_, i) => `level${i + 10}`).join("/") +
					"/file.txt";
				expect(entries[0].header.name).toBe(expectedPath);
			});
		});

		describe("interaction with other options", () => {
			it("applies strip before filter", async () => {
				const archive = await packTar([
					{
						header: { name: "remove/keep.txt", size: 4, type: "file" },
						body: "keep",
					},
					{
						header: { name: "remove/skip.js", size: 4, type: "file" },
						body: "skip",
					},
				]);

				const entries = await unpackTar(archive, {
					strip: 1,
					filter: (header) => header.name.endsWith(".txt"),
				});

				// Strip happens first: "remove/keep.txt" → "keep.txt"
				// Then filter: only ".txt" files pass
				expect(entries).toHaveLength(1);
				expect(entries[0].header.name).toBe("keep.txt");
			});

			it("applies strip before map", async () => {
				const archive = await packTar([
					{
						header: { name: "prefix/file.txt", size: 4, type: "file" },
						body: "test",
					},
				]);

				const entries = await unpackTar(archive, {
					strip: 1,
					map: (header) => ({
						...header,
						name: `mapped-${header.name}`,
					}),
				});

				// Strip happens first: "prefix/file.txt" → "file.txt"
				// Then map: "file.txt" → "mapped-file.txt"
				expect(entries).toHaveLength(1);
				expect(entries[0].header.name).toBe("mapped-file.txt");
			});

			it("handles strip with filter that rejects everything", async () => {
				const archive = await packTar([
					{
						header: { name: "a/b/file.txt", size: 4, type: "file" },
						body: "test",
					},
				]);

				const entries = await unpackTar(archive, {
					strip: 1,
					filter: () => false, // Reject everything
				});

				expect(entries).toHaveLength(0);
			});
		});

		describe("boundary conditions", () => {
			it("handles strip value of 0", async () => {
				const archive = await packTar([
					{
						header: { name: "path/to/file.txt", size: 4, type: "file" },
						body: "test",
					},
				]);

				const entries = await unpackTar(archive, { strip: 0 });

				// No stripping should occur
				expect(entries).toHaveLength(1);
				expect(entries[0].header.name).toBe("path/to/file.txt");
			});

			it("handles very large strip value", async () => {
				const archive = await packTar([
					{
						header: { name: "a/b/file.txt", size: 4, type: "file" },
						body: "test",
					},
				]);

				const entries = await unpackTar(archive, { strip: 1000 });

				// Should filter out everything since strip > path components
				expect(entries).toHaveLength(0);
			});

			it("handles negative strip value gracefully", async () => {
				const archive = await packTar([
					{
						header: { name: "path/to/file.txt", size: 4, type: "file" },
						body: "test",
					},
				]);

				const entries = await unpackTar(archive, { strip: -1 });

				// Negative strip should be treated as 0 (no stripping)
				expect(entries).toHaveLength(1);
				expect(entries[0].header.name).toBe("path/to/file.txt");
			});
		});

		describe("real-world scenarios", () => {
			it("handles typical archive extraction (strip common prefix)", async () => {
				// Simulate extracting a GitHub archive that has a common prefix
				const archive = await packTar([
					{
						header: { name: "project-main/README.md", size: 6, type: "file" },
						body: "readme",
					},
					{
						header: { name: "project-main/src/", type: "directory", size: 0 },
					},
					{
						header: {
							name: "project-main/src/index.js",
							size: 5,
							type: "file",
						},
						body: "index",
					},
					{
						header: {
							name: "project-main/package.json",
							size: 7,
							type: "file",
						},
						body: "package",
					},
				]);

				const entries = await unpackTar(archive, { strip: 1 });

				expect(entries).toHaveLength(4);

				const names = entries.map((e) => e.header.name).sort();
				expect(names).toEqual([
					"README.md",
					"package.json",
					"src/",
					"src/index.js",
				]);
			});

			it("handles tar created with absolute paths", async () => {
				const archive = await packTar([
					{
						header: { name: "/absolute/path/file.txt", size: 4, type: "file" },
						body: "test",
					},
				]);

				const entries = await unpackTar(archive, { strip: 2 });

				// After strip: 2
				// "/absolute/path/file.txt" → ["absolute", "path", "file.txt"] → strip 2 → ["file.txt"] → "file.txt"
				// Note: Leading slash is treated as empty component and filtered out
				expect(entries).toHaveLength(1);
				expect(entries[0].header.name).toBe("file.txt");
			});
		});
	});

	describe("filter option", () => {
		it("filters by file extension", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, {
				filter: (header) =>
					header.name.endsWith(".js") || header.name.endsWith(".json"),
			});

			expect(entries).toHaveLength(2);
			expect(entries[0].header.name).toBe("root/level1/file2.js");
			expect(entries[1].header.name).toBe("root/level1/subdir/nested.json");
		});

		it("filters by entry type", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, {
				filter: (header) => header.type === "file",
			});

			expect(entries).toHaveLength(4); // All files, no directories
			expect(entries.every((e) => e.header.type === "file")).toBe(true);
		});

		it("filters by path pattern", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, {
				filter: (header) => header.name.includes("level1"),
			});

			expect(entries).toHaveLength(4);
			expect(entries.every((e) => e.header.name.includes("level1"))).toBe(true);
		});

		it("filters by file permissions", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, {
				filter: (header) => (header.mode || 0) >= 0o700,
			});

			expect(entries).toHaveLength(2); // file2.js (0o755) and subdir (0o755)
			expect(entries[0].header.name).toBe("root/level1/file2.js");
			expect(entries[1].header.name).toBe("root/level1/subdir/");
		});

		it("returns empty result when all entries filtered out", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, {
				filter: () => false,
			});

			expect(entries).toHaveLength(0);
		});
	});

	describe("map option", () => {
		it("transforms entry names", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, {
				map: (header) => ({
					...header,
					name: header.name.toLowerCase(),
				}),
			});

			expect(entries).toHaveLength(5);
			expect(entries[0].header.name).toBe("root/level1/file1.txt");
			expect(entries[1].header.name).toBe("root/level1/file2.js");
		});

		it("transforms file permissions", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, {
				map: (header) => ({
					...header,
					mode: header.type === "file" ? 0o644 : 0o755,
				}),
			});

			expect(entries).toHaveLength(5);
			const files = entries.filter((e) => e.header.type === "file");
			const dirs = entries.filter((e) => e.header.type === "directory");

			expect(files.every((e) => e.header.mode === 0o644)).toBe(true);
			expect(dirs.every((e) => e.header.mode === 0o755)).toBe(true);
		});

		it("adds prefix to all paths", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, {
				map: (header) => ({
					...header,
					name: `extracted/${header.name}`,
				}),
			});

			expect(entries).toHaveLength(5);
			expect(entries.every((e) => e.header.name.startsWith("extracted/"))).toBe(
				true,
			);
			expect(entries[0].header.name).toBe("extracted/root/level1/file1.txt");
		});

		it("transforms metadata fields", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, {
				map: (header) => ({
					...header,
					uname: "test-user",
					gname: "test-group",
					uid: 1000,
					gid: 1000,
				}),
			});

			expect(entries).toHaveLength(5);
			expect(entries.every((e) => e.header.uname === "test-user")).toBe(true);
			expect(entries.every((e) => e.header.gname === "test-group")).toBe(true);
			expect(entries.every((e) => e.header.uid === 1000)).toBe(true);
			expect(entries.every((e) => e.header.gid === 1000)).toBe(true);
		});
	});

	describe("combined options", () => {
		it("applies strip, filter, and map together", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, {
				strip: 2, // Remove "root/level1"
				filter: (header) =>
					header.type === "file" && header.name.endsWith(".txt"),
				map: (header) => ({
					...header,
					name: `processed/${header.name}`,
					mode: 0o644,
				}),
			});

			expect(entries).toHaveLength(1);
			expect(entries[0].header.name).toBe("processed/file1.txt");
			expect(entries[0].header.mode).toBe(0o644);
			expect(decoder.decode(entries[0].data)).toBe("content-1\n");
		});

		it("applies options in correct order (strip -> filter -> map)", async () => {
			const archive = await createTestArchive();

			// Create a more complex scenario to test order
			const entries = await unpackTar(archive, {
				strip: 1, // "root/level1/file1.txt" becomes "level1/file1.txt"
				filter: (header) => header.name.includes("level1"), // Should work on stripped names
				map: (header) => ({
					...header,
					name: header.name.replace("level1", "processed"), // Should work on filtered results
				}),
			});

			expect(entries).toHaveLength(4);
			expect(entries[0].header.name).toBe("processed/file1.txt");
			expect(entries[1].header.name).toBe("processed/file2.js");
			expect(entries[2].header.name).toBe("processed/subdir/");
			expect(entries[3].header.name).toBe("processed/subdir/nested.json");
		});

		it("handles edge case where strip makes filter irrelevant", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, {
				strip: 5, // Strip so much that most entries become empty
				filter: (header) => header.name.includes("something"), // This won't match anything
				map: (header) => ({ ...header, name: `mapped/${header.name}` }),
			});

			expect(entries).toHaveLength(0);
		});
	});

	describe("data integrity", () => {
		it("preserves file content through all transformations", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, {
				strip: 1,
				filter: (header) => header.name.includes("file1"),
				map: (header) => ({ ...header, name: `new-${header.name}` }),
			});

			expect(entries).toHaveLength(1);
			expect(entries[0].header.name).toBe("new-level1/file1.txt");
			expect(decoder.decode(entries[0].data)).toBe("content-1\n");
		});

		it("preserves directory entries correctly", async () => {
			const archive = await createTestArchive();
			const entries = await unpackTar(archive, {
				filter: (header) => header.type === "directory",
				map: (header) => ({ ...header, name: header.name.toUpperCase() }),
			});

			expect(entries).toHaveLength(1);
			expect(entries[0].header.name).toBe("ROOT/LEVEL1/SUBDIR/");
			expect(entries[0].header.type).toBe("directory");
			expect(entries[0].data).toHaveLength(0);
		});
	});

	describe("edge cases", () => {
		it("handles empty archive", async () => {
			const emptyArchive = await packTar([]);
			const entries = await unpackTar(emptyArchive, {
				strip: 1,
				filter: () => true,
				map: (header) => header,
			});

			expect(entries).toHaveLength(0);
		});

		it("handles single entry archive", async () => {
			const singleArchive = await packTar([
				{
					header: { name: "single.txt", size: 4, type: "file" },
					body: "test",
				},
			]);

			const entries = await unpackTar(singleArchive, {
				map: (header) => ({ ...header, name: `modified-${header.name}` }),
			});

			expect(entries).toHaveLength(1);
			expect(entries[0].header.name).toBe("modified-single.txt");
			expect(decoder.decode(entries[0].data)).toBe("test");
		});

		it("handles entries with no extension", async () => {
			const archive = await packTar([
				{
					header: { name: "README", size: 5, type: "file" },
					body: "hello",
				},
			]);

			const entries = await unpackTar(archive, {
				filter: (header) => !header.name.includes("."),
			});

			expect(entries).toHaveLength(1);
			expect(entries[0].header.name).toBe("README");
		});
	});

	describe("transform stream edge cases", () => {
		it("handles filter functions that return false for all entries", async () => {
			const archive = await createTestArchive();

			// Filter that rejects everything
			const entries = await unpackTar(archive, {
				filter: () => false,
			});

			expect(entries).toHaveLength(0);
		});

		it("handles map functions that modify headers", async () => {
			const archive = await createTestArchive();

			// Map function that modifies headers
			const entries = await unpackTar(archive, {
				map: (header) => {
					if (header.name.includes("file1")) {
						return {
							...header,
							name: header.name.replace("file1", "renamed1"),
						};
					}
					return header;
				},
			});

			// Should include renamed file1.txt
			expect(entries.some((e) => e.header.name.includes("renamed1"))).toBe(
				true,
			);
			expect(entries.some((e) => e.header.name.includes("file2"))).toBe(true);
		});

		it("handles map functions that throw errors", async () => {
			const archive = await createTestArchive();

			await expect(
				unpackTar(archive, {
					map: (header) => {
						if (header.name.includes("file1")) {
							throw new Error("Map function error");
						}
						return header;
					},
				}),
			).rejects.toThrow("Map function error");
		});

		it("handles filter functions that throw errors", async () => {
			const archive = await createTestArchive();

			await expect(
				unpackTar(archive, {
					filter: (header) => {
						if (header.name.includes("file1")) {
							throw new Error("Filter function error");
						}
						return true;
					},
				}),
			).rejects.toThrow("Filter function error");
		});

		it("handles boundary conditions with empty archives", async () => {
			// Create an empty tar archive (just EOF blocks)
			const eofBlock1 = new Uint8Array(512);
			const eofBlock2 = new Uint8Array(512);
			const emptyArchive = new Uint8Array(1024);
			emptyArchive.set(eofBlock1, 0);
			emptyArchive.set(eofBlock2, 512);

			const entries = await unpackTar(emptyArchive, {
				filter: () => true,
				map: (header) => header,
			});

			expect(entries).toHaveLength(0);
		});

		it("handles complex chained transformations", async () => {
			const archive = await createTestArchive();

			const entries = await unpackTar(archive, {
				filter: (header) => {
					// Only .txt and .js files
					return header.name.endsWith(".txt") || header.name.endsWith(".js");
				},
				map: (header) => {
					// Rename all files to add a prefix
					return {
						...header,
						name: `processed-${header.name}`,
					};
				},
			});

			// Should have 2 files (file1.txt and file2.js)
			expect(entries).toHaveLength(2);
			expect(entries.every((e) => e.header.name.startsWith("processed-"))).toBe(
				true,
			);
			expect(entries.some((e) => e.header.name.includes("file1.txt"))).toBe(
				true,
			);
			expect(entries.some((e) => e.header.name.includes("file2.js"))).toBe(
				true,
			);
		});
	});
});
