/** biome-ignore-all lint/style/noNonNullAssertion: Tests */
import { describe, expect, it } from "vitest";
import { decoder, isBodyless } from "../../src/tar/utils";
import { packTar, unpackTar } from "../../src/web/helpers";
import type { TarEntry } from "../../src/web/types";

describe("repack", () => {
	it("handles unpack then repack correctly", async () => {
		// Create a test archive with various entry types
		const originalEntries: TarEntry[] = [
			{
				header: { name: "file.txt", size: 11, type: "file" },
				body: "hello world",
			},
			{
				header: { name: "empty.txt", size: 0, type: "file" },
				body: "",
			},
			{
				header: { name: "dir/", type: "directory", size: 0 },
			},
			{
				header: { name: "dir/nested.txt", size: 12, type: "file" },
				body: "nested file!",
			},
			{
				header: {
					name: "link",
					type: "symlink",
					size: 0,
					linkname: "file.txt",
				},
			},
		];

		// Pack the original entries
		const originalArchive = await packTar(originalEntries);

		// Unpack the archive
		const unpackedEntries = await unpackTar(originalArchive);

		// Verify unpacked data matches expected structure
		expect(unpackedEntries).toHaveLength(5);
		expect(unpackedEntries[0].header.name).toBe("file.txt");
		expect(unpackedEntries[0].header.size).toBe(11);
		expect(unpackedEntries[0].data).toBeDefined();
		expect(unpackedEntries[0].data!.length).toBe(11);
		expect(decoder.decode(unpackedEntries[0].data!)).toBe("hello world");

		expect(unpackedEntries[1].header.name).toBe("empty.txt");
		expect(unpackedEntries[1].header.size).toBe(0);
		expect(unpackedEntries[1].data).toBeDefined();
		expect(unpackedEntries[1].data!.length).toBe(0);

		expect(unpackedEntries[2].header.name).toBe("dir/");
		expect(unpackedEntries[2].header.type).toBe("directory");
		expect(unpackedEntries[2].header.size).toBe(0);
		expect(unpackedEntries[2].data).toBeUndefined();

		expect(unpackedEntries[3].header.name).toBe("dir/nested.txt");
		expect(unpackedEntries[3].header.size).toBe(12);
		expect(unpackedEntries[3].data).toBeDefined();
		expect(unpackedEntries[3].data!.length).toBe(12);
		expect(decoder.decode(unpackedEntries[3].data!)).toBe("nested file!");

		expect(unpackedEntries[4].header.name).toBe("link");
		expect(unpackedEntries[4].header.type).toBe("symlink");
		expect(unpackedEntries[4].header.size).toBe(0);
		expect(unpackedEntries[4].data).toBeUndefined();

		// With unified API, unpacked entries can be repacked directly
		const entriesForRepack: TarEntry[] = unpackedEntries;

		// This should not throw an error (this was the original bug)
		const repackedArchive = await packTar(entriesForRepack);

		// Verify the repacked archive can be unpacked correctly
		const finalEntries = await unpackTar(repackedArchive);

		// Verify round-trip integrity
		expect(finalEntries).toHaveLength(originalEntries.length);

		for (let i = 0; i < finalEntries.length; i++) {
			const final = finalEntries[i];
			const original = originalEntries[i];

			expect(final.header.name).toBe(original.header.name);
			expect(final.header.type).toBe(original.header.type);
			expect(final.header.size).toBe(original.header.size);

			if (isBodyless(original.header)) {
				expect(final.data).toBeUndefined();
			} else {
				expect(final.data).toBeDefined();
				expect(final.data!.length).toBe(original.header.size);
				if (original.body && typeof original.body === "string") {
					expect(decoder.decode(final.data!)).toBe(original.body);
				}
			}
		}
	});

	it("handles bodyless entries correctly during repack", async () => {
		// Test specifically for the case where bodyless entries have empty Uint8Array bodies
		const entries: TarEntry[] = [
			{
				header: { name: "dir/", type: "directory", size: 0 },
				body: new Uint8Array(0), // Empty Uint8Array (truthy but no content)
			},
			{
				header: {
					name: "symlink",
					type: "symlink",
					size: 0,
					linkname: "target",
				},
				body: new Uint8Array(0), // Empty Uint8Array
			},
		];

		// This should not throw "No active tar entry" error
		const archive = await packTar(entries);

		// Verify the archive is valid
		const unpacked = await unpackTar(archive);
		expect(unpacked).toHaveLength(2);
		expect(unpacked[0].header.type).toBe("directory");
		expect(unpacked[1].header.type).toBe("symlink");
	});

	it("still validates invalid body types for non-bodyless entries", async () => {
		// Ensure our fix doesn't break validation for actual invalid bodies
		const invalidEntries: TarEntry[] = [
			{
				header: { name: "test.txt", size: 5, type: "file" },
				// biome-ignore lint/suspicious/noExplicitAny: Intentionally invalid for testing
				body: true as any, // Invalid body type
			},
		];

		await expect(packTar(invalidEntries)).rejects.toThrow(
			/Unsupported content type/,
		);
	});

	it("handles empty files correctly", async () => {
		// Test files with size 0 but valid body types
		const entries: TarEntry[] = [
			{
				header: { name: "empty-string.txt", size: 0, type: "file" },
				body: "", // Empty string
			},
			{
				header: { name: "empty-uint8.txt", size: 0, type: "file" },
				body: new Uint8Array(0), // Empty Uint8Array
			},
			{
				header: { name: "null-body.txt", size: 0, type: "file" },
				body: null, // Null body
			},
		];

		const archive = await packTar(entries);
		const unpacked = await unpackTar(archive);

		expect(unpacked).toHaveLength(3);
		unpacked.forEach((entry) => {
			expect(entry.header.size).toBe(0);
			expect(entry.data).toBeDefined();
			expect(entry.data!.length).toBe(0);
		});
	});
});
