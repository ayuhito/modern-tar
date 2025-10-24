import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decoder } from "../../src/tar/utils";
import { packTar, unpackTar } from "../../src/web/helpers";

describe("repack", () => {
	it("successfully repacks unpacked entries", async () => {
		const originalEntries = [
			{
				header: { name: "example.txt", size: 11, type: "file" as const },
				body: "hello world",
			},
			{
				header: { name: "empty.txt", size: 0, type: "file" as const },
				body: "",
			},
			{
				header: { name: "dir/", type: "directory" as const, size: 0 },
			},
		];

		const archive = await packTar(originalEntries);
		const tempPath = join(tmpdir(), "test-repack.tar");
		await writeFile(tempPath, archive);

		// Original workflow that was failing
		const data = await readFile(tempPath);
		const entries = await unpackTar(data);

		// This used to throw "Size mismatch" but now works
		const repackedArchive = await packTar(entries);

		// Verify integrity
		const verifyEntries = await unpackTar(repackedArchive);
		expect(verifyEntries).toHaveLength(3);

		const textFile = verifyEntries.find((e) => e.header.name === "example.txt");
		expect(decoder.decode(textFile?.data)).toBe("hello world");
	});

	it("supports adding new entries to existing archive", async () => {
		const original = await packTar([
			{
				header: { name: "existing.txt", size: 8, type: "file" as const },
				body: "existing",
			},
		]);

		// Unpack and add new entries
		const entries = await unpackTar(original);
		const newEntry = {
			header: { name: "new.txt", size: 3, type: "file" as const },
			body: "new",
		};

		// Combine and repack
		const updatedArchive = await packTar([...entries, newEntry]);
		const finalEntries = await unpackTar(updatedArchive);

		expect(finalEntries).toHaveLength(2);
		expect(finalEntries.map((e) => e.header.name)).toEqual([
			"existing.txt",
			"new.txt",
		]);
	});

	it("handles mixed entry formats", async () => {
		// Fresh entry with body
		const freshEntry = {
			header: { name: "fresh.txt", size: 5, type: "file" as const },
			body: "fresh",
		};

		// Unpacked entry with data
		const archive = await packTar([freshEntry]);
		const [unpackedEntry] = await unpackTar(archive);

		// Mix both formats in one call
		const mixedEntries = [
			unpackedEntry, // Has 'data' property
			{
				header: { name: "another.txt", size: 7, type: "file" as const },
				body: "another", // Has 'body' property
			},
		];

		const mixedArchive = await packTar(mixedEntries);
		const verifyEntries = await unpackTar(mixedArchive);

		expect(verifyEntries).toHaveLength(2);
		expect(decoder.decode(verifyEntries[0].data)).toBe("fresh");
		expect(decoder.decode(verifyEntries[1].data)).toBe("another");
	});
});
