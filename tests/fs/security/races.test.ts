import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { describe, expect } from "vitest";
import { unpackTar } from "../../../src/fs";
import { createOperationQueue } from "../../../src/fs/concurrency";
import { createPathCache } from "../../../src/fs/path-cache";
import { packTar, type TarEntry } from "../../../src/web";
import { it } from "../../helpers/test";
import { writeChunk } from "./helpers";

describe("path races and collisions", () => {
	describe("pre-existing path attacks", () => {
		it.skipIf(process.platform === "win32")(
			"replaces pre-existing link leaves without following them",
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				const outsideDir = path.join(tmpDir, "outside");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.mkdir(outsideDir, { recursive: true });

				const victimPath = path.join(outsideDir, "victim.txt");
				await fs.writeFile(victimPath, "original");

				const leafSymlink = path.join(extractDir, "escape.txt");
				await fs.symlink(path.relative(extractDir, victimPath), leafSymlink);

				const linkedLeaf = path.join(extractDir, "linked.txt");
				await fs.link(victimPath, linkedLeaf);

				const entries: TarEntry[] = [
					{
						header: {
							name: "escape.txt",
							size: 6,
							type: "file",
							mode: 0o644,
						},
						body: "pwned!",
					},
					{
						header: {
							name: "linked.txt",
							size: 8,
							type: "file",
							mode: 0o644,
						},
						body: "changed!",
					},
				];

				const tarBuffer = await packTar(entries);
				const maliciousTar = Readable.from([tarBuffer]);
				const unpackStream = unpackTar(extractDir);

				await expect(
					pipeline(maliciousTar, unpackStream),
				).resolves.toBeUndefined();

				expect(await fs.readFile(victimPath, "utf8")).toBe("original");
				expect(await fs.readFile(leafSymlink, "utf8")).toBe("pwned!");
				expect(await fs.readFile(linkedLeaf, "utf8")).toBe("changed!");
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents file bodies from following a replaced parent directory",
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				const outsideDir = path.join(tmpDir, "outside");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.mkdir(outsideDir, { recursive: true });

				const tarBuffer = await packTar([
					{
						header: {
							name: "dir/file.txt",
							size: 5,
							type: "file",
						},
						body: "pwned",
					},
				]);
				const unpackStream = unpackTar(extractDir);

				await writeChunk(unpackStream, tarBuffer.subarray(0, 512));
				await fs.rm(path.join(extractDir, "dir"), {
					recursive: true,
					force: true,
				});
				await fs.symlink("../outside", path.join(extractDir, "dir"));

				unpackStream.end(tarBuffer.subarray(512));
				await finished(unpackStream).catch(() => undefined);

				await expect(
					fs.access(path.join(outsideDir, "file.txt")),
				).rejects.toThrow();
			},
		);

		it.skipIf(process.platform === "win32")(
			"prevents deferred hardlinks from following a replaced target parent",
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				const outsideDir = path.join(tmpDir, "outside");
				await fs.mkdir(extractDir, { recursive: true });
				await fs.mkdir(outsideDir, { recursive: true });

				const outsideFile = path.join(outsideDir, "file.txt");
				await fs.writeFile(outsideFile, "outside-secret");

				const tarBuffer = await packTar([
					{
						header: {
							name: "target/file.txt",
							size: 6,
							type: "file",
						},
						body: "inside",
					},
					{
						header: {
							name: "link.txt",
							size: 0,
							type: "link",
							linkname: "target/file.txt",
						},
					},
				]);
				const eofOffset = tarBuffer.length - 1024;
				const unpackStream = unpackTar(extractDir);

				await writeChunk(unpackStream, tarBuffer.subarray(0, eofOffset));
				await fs.rm(path.join(extractDir, "target"), {
					recursive: true,
					force: true,
				});
				await fs.symlink("../outside", path.join(extractDir, "target"));

				unpackStream.end(tarBuffer.subarray(eofOffset));
				await finished(unpackStream).catch(() => undefined);

				const outsideStat = await fs.stat(outsideFile);
				try {
					const linkStat = await fs.stat(path.join(extractDir, "link.txt"));
					expect({
						dev: linkStat.dev,
						ino: linkStat.ino,
					}).not.toEqual({
						dev: outsideStat.dev,
						ino: outsideStat.ino,
					});
				} catch (err) {
					expect((err as NodeJS.ErrnoException).code).toBe("ENOENT");
				}
			},
		);
	});
	describe("path collision and concurrency edge cases", () => {
		it.for([{ directoryName: "config/" }, { directoryName: "config\\" }])(
			"rejects a $directoryName directory followed by a file at the same normalized path",
			async ({ directoryName }, { tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				await fs.mkdir(extractDir, { recursive: true });

				const entries: TarEntry[] = [
					{
						header: {
							name: directoryName,
							size: 0,
							type: "directory",
						},
					},
					{
						header: {
							name: "config",
							size: 4,
							type: "file",
						},
						body: "test",
					},
				];

				await expect(
					pipeline(
						Readable.from([await packTar(entries)]),
						unpackTar(extractDir),
					),
				).rejects.toThrow(/Path conflict/);

				const stats = await fs.stat(path.join(extractDir, "config"));
				expect(stats.isDirectory()).toBe(true);
			},
		);

		it("handles file then directory with same normalized path", async ({
			tmpDir,
		}) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "data",
						size: 8,
						type: "file",
						mode: 0o644,
					},
					body: "filedata",
				},
				{
					header: {
						name: "data/", // Same path but as directory
						size: 0,
						type: "directory",
						mode: 0o755,
					},
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			// Should reject due to path conflict
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				/Path conflict/,
			);

			// File should still exist (first entry wins)
			const dataPath = path.join(extractDir, "data");
			const stats = await fs.stat(dataPath);
			expect(stats.isFile()).toBe(true);
		});

		it("handles multiple entries with conflicting normalized paths", async ({
			tmpDir,
		}) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "shared/",
						size: 0,
						type: "directory",
						mode: 0o755,
					},
				},
				{
					header: {
						name: "shared",
						size: 5,
						type: "file",
						mode: 0o644,
					},
					body: "file1",
				},
				{
					header: {
						name: "shared/",
						size: 0,
						type: "directory",
						mode: 0o755,
					},
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			// Should reject due to type conflict
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow();

			// Only the first directory should exist
			const sharedPath = path.join(extractDir, "shared");
			const stats = await fs.stat(sharedPath);
			expect(stats.isDirectory()).toBe(true);
		});

		it("follows filesystem semantics for Unicode-equivalent names", async ({
			tmpDir,
		}) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const name1 = "café"; // composed form
			const name2 = "cafe\u0301"; // decomposed form (e + combining acute accent)
			const probeDir = path.join(tmpDir, "unicode-probe");
			await fs.mkdir(path.join(probeDir, name1), { recursive: true });
			const namesAlias = await fs
				.lstat(path.join(probeDir, name2))
				.then(() => true)
				.catch(() => false);

			const entries: TarEntry[] = [
				{
					header: {
						name: `${name1}/`,
						size: 0,
						type: "directory",
					},
				},
				{
					header: {
						name: name2,
						size: 8,
						type: "file",
					},
					body: "conflict",
				},
			];

			const tarBuffer = await packTar(entries);
			const extraction = pipeline(
				Readable.from([tarBuffer]),
				unpackTar(extractDir),
			);
			if (namesAlias) {
				await expect(extraction).rejects.toThrow();
				expect(
					(await fs.stat(path.join(extractDir, name1))).isDirectory(),
				).toBe(true);
			} else {
				await expect(extraction).resolves.toBeUndefined();
				expect(
					(await fs.stat(path.join(extractDir, name1))).isDirectory(),
				).toBe(true);
				expect((await fs.stat(path.join(extractDir, name2))).isFile()).toBe(
					true,
				);
			}
		});

		it("keeps the first duplicate file", async ({ tmpDir }) => {
			const extractDir = path.join(tmpDir, "extract");
			const entries: TarEntry[] = [
				{
					header: { name: "dup.txt", size: 5, type: "file" },
					body: "FIRST",
				},
				{
					header: { name: "dup.txt", size: 6, type: "file" },
					body: "SECOND",
				},
			];

			await pipeline(
				Readable.from([await packTar(entries)]),
				unpackTar(extractDir),
			);

			expect(await fs.readFile(path.join(extractDir, "dup.txt"), "utf8")).toBe(
				"FIRST",
			);
		});

		it.for([{ concurrency: 1 }, { concurrency: 8 }])(
			"keeps the first file across equivalent paths at concurrency $concurrency",
			async ({ concurrency }, { tmpDir }) => {
				const extractDir = path.join(tmpDir, "extract");
				const bodies = ["FIRST", "SECOND", "THIRD", "FOURTH"];
				const entries: TarEntry[] = [
					"same/file",
					"same//file",
					"same/./file",
					"./same/file",
				].map((name, index) => ({
					header: { name, size: bodies[index].length, type: "file" },
					body: bodies[index],
				}));

				await pipeline(
					Readable.from([await packTar(entries)]),
					unpackTar(extractDir, { concurrency }),
				);

				expect(
					await fs.readFile(path.join(extractDir, "same", "file"), "utf8"),
				).toBe("FIRST");
			},
		);

		it("tracks duplicates beyond the path-cache capacity", async ({
			tmpDir,
		}) => {
			const queue = createOperationQueue(1);
			const cache = createPathCache(tmpDir, {}, queue, 1);
			const header = (name: string): TarEntry["header"] => ({
				name,
				size: 0,
				type: "file",
			});

			expect(await cache.preparePath(header("dup.txt"))).toBe(
				path.join(await fs.realpath(tmpDir), "dup.txt"),
			);
			for (let index = 0; index < 10_000; index++) {
				await cache.preparePath(header(`filler-${index}.txt`));
			}
			expect(await cache.preparePath(header("dup.txt"))).toBeUndefined();
		});

		it("allows legitimate same-type operations on same path", async ({
			tmpDir,
		}) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "docs/",
						size: 0,
						type: "directory",
						mode: 0o755,
					},
				},
				{
					header: {
						name: "docs/", // Same directory again
						size: 0,
						type: "directory",
						mode: 0o755,
					},
				},
			];

			const tarBuffer = await packTar(entries);
			const tarStream = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			// Should succeed - creating same directory twice is OK
			await expect(pipeline(tarStream, unpackStream)).resolves.toBeUndefined();

			const docsPath = path.join(extractDir, "docs");
			const stats = await fs.stat(docsPath);
			expect(stats.isDirectory()).toBe(true);
		});

		it("handles path separator edge cases", async ({ tmpDir }) => {
			const extractDir = path.join(tmpDir, "extract");
			await fs.mkdir(extractDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "folder/",
						size: 0,
						type: "directory",
						mode: 0o755,
					},
				},
				{
					header: {
						name: "folder", // No trailing slash should still normalize to same path but remain a file
						size: 4,
						type: "file",
						mode: 0o644,
					},
					body: "test",
				},
			];

			const tarBuffer = await packTar(entries);
			const maliciousTar = Readable.from([tarBuffer]);
			const unpackStream = unpackTar(extractDir);

			// Should handle path normalization correctly and reject conflict
			await expect(pipeline(maliciousTar, unpackStream)).rejects.toThrow(
				/Path conflict/,
			);
		});
	});
});
