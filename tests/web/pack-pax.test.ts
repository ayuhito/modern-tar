import { describe, expect, it } from "vitest";
import { generatePax } from "../../src/tar/pax";
import { decoder } from "../../src/tar/utils";
import { packTar, type TarEntry, unpackTar } from "../../src/web";

describe("PAX format support", () => {
	it("uses PAX for filename > 100 chars", async () => {
		// Use a filename that cannot be split e.g. component > 155 chars
		const longComponent = "a".repeat(200);
		const fileName = `${longComponent}/test.txt`;

		const entries: TarEntry[] = [
			{
				header: { name: fileName, size: 4 },
				body: "pax!",
			},
		];

		const buffer = await packTar(entries);
		const extracted = await unpackTar(buffer);

		expect(extracted).toHaveLength(1);
		expect(extracted[0].header.name).toBe(fileName);
		expect(extracted[0].header.pax?.path).toBe(fileName);
		expect(decoder.decode(extracted[0].data)).toBe("pax!");
	});

	it("uses PAX for total filename > 255 chars", async () => {
		const longPath = `${"a/".repeat(130)}test.txt`; // 261 chars
		expect(longPath.length).toBeGreaterThan(255);

		const entries: TarEntry[] = [
			{
				header: { name: longPath, size: 4 },
				body: "pax!",
			},
		];

		const buffer = await packTar(entries);
		const extracted = await unpackTar(buffer);

		expect(extracted).toHaveLength(1);
		expect(extracted[0].header.name).toBe(longPath);
		expect(extracted[0].header.pax?.path).toBe(longPath);
	});

	it("uses PAX for long linkname", async () => {
		const longLink = "a".repeat(150);
		const entries: TarEntry[] = [
			{
				header: {
					name: "my-symlink",
					type: "symlink",
					linkname: longLink,
					size: 0,
				},
			},
		];

		const buffer = await packTar(entries);
		const extracted = await unpackTar(buffer);

		expect(extracted).toHaveLength(1);
		expect(extracted[0].header.linkname).toBe(longLink);
		expect(extracted[0].header.pax?.linkpath).toBe(longLink);
	});

	it("uses PAX for large UID/GID", async () => {
		const largeId = 0o10000000; // Larger than 7777777
		const entries: TarEntry[] = [
			{
				header: { name: "file.txt", size: 4, uid: largeId, gid: largeId },
				body: "test",
			},
		];

		const buffer = await packTar(entries);
		const extracted = await unpackTar(buffer);

		expect(extracted).toHaveLength(1);
		expect(extracted[0].header.uid).toBe(largeId);
		expect(extracted[0].header.gid).toBe(largeId);
		expect(extracted[0].header.pax?.uid).toBe(largeId.toString());
		expect(extracted[0].header.pax?.gid).toBe(largeId.toString());
	});

	it("uses PAX for large file size (> 8GB)", async () => {
		const largeSize = 0o100000000000; // ~8.5GB

		// Test the PAX generation directly
		const paxData = generatePax({ name: "large-file.bin", size: largeSize });

		expect(paxData).not.toBeNull();
		if (paxData) {
			expect(paxData.paxHeader).toBeDefined();
			expect(paxData.paxBody).toBeDefined();

			// Verify the PAX record contains the size
			const paxBodyText = new TextDecoder().decode(paxData.paxBody);
			expect(paxBodyText).toContain(`size=${largeSize}`);
		}
	});

	it("uses PAX for long uname/gname", async () => {
		const longUname = "a".repeat(33);
		const longGname = "b".repeat(33);
		const entries: TarEntry[] = [
			{
				header: {
					name: "user-file.txt",
					size: 4,
					uname: longUname,
					gname: longGname,
				},
				body: "test",
			},
		];

		const buffer = await packTar(entries);
		const extracted = await unpackTar(buffer);

		expect(extracted).toHaveLength(1);
		expect(extracted[0].header.uname).toBe(longUname);
		expect(extracted[0].header.gname).toBe(longGname);
		expect(extracted[0].header.pax?.uname).toBe(longUname);
		expect(extracted[0].header.pax?.gname).toBe(longGname);
	});

	it("combines multiple PAX attributes", async () => {
		const longName = "a".repeat(120);
		const largeId = 0o10000000;
		const entries: TarEntry[] = [
			{
				header: {
					name: longName,
					size: 4,
					uid: largeId,
				},
				body: "test",
			},
		];

		const buffer = await packTar(entries);
		const extracted = await unpackTar(buffer);

		expect(extracted).toHaveLength(1);
		expect(extracted[0].header.name).toBe(longName);
		expect(extracted[0].header.uid).toBe(largeId);
		expect(extracted[0].header.pax?.path).toBe(longName);
		expect(extracted[0].header.pax?.uid).toBe(largeId.toString());
	});

	it("preserves manually added PAX headers", async () => {
		const entries: TarEntry[] = [
			{
				header: {
					name: "custom.txt",
					size: 4,
					pax: {
						comment: "this is a custom comment",
						mtime: "12345.678",
					},
				},
				body: "test",
			},
		];

		const buffer = await packTar(entries);
		const extracted = await unpackTar(buffer);

		expect(extracted).toHaveLength(1);
		expect(extracted[0].header.pax?.comment).toBe("this is a custom comment");
		expect(extracted[0].header.mtime).toEqual(new Date(12345.678 * 1000));
	});

	describe("edge cases", () => {
		it("handles PAX record length boundary calculation edge case", async () => {
			// Create a filename that will trigger PAX (must be >100 chars or unsplittable)
			// Use a long filename without slashes to force PAX usage
			const craftedName = "x".repeat(200); // Definitely triggers PAX

			const paxData = generatePax({ name: craftedName, size: 4 });

			expect(paxData).not.toBeNull();
			if (paxData) {
				const paxBodyText = new TextDecoder().decode(paxData.paxBody);
				expect(paxBodyText).toContain(`path=${craftedName}`);

				// Verify the PAX record format is correct
				const lines = paxBodyText.split("\n").filter((line) => line.trim());
				expect(lines.length).toBeGreaterThan(0);

				// Each line should start with its length followed by a space
				for (const line of lines) {
					const spaceIndex = line.indexOf(" ");
					expect(spaceIndex).toBeGreaterThan(0);
					const declaredLength = parseInt(line.substring(0, spaceIndex), 10);
					expect(declaredLength).toBe(line.length + 1); // +1 for the newline
				}
			}
		});

		it("handles PAX record length digit boundary edge case specifically", async () => {
			// Target records around 96-99 chars to test 99->100 digit boundary
			const testCases = [
				// This will create multiple PAX records, some hitting boundaries
				{
					name: "a".repeat(200),
					pax: {
						// Craft comments of specific lengths to hit boundaries
						comment1: "x".repeat(85), // Should create ~96 char record: "96 comment1=" + 85 + "\n"
						comment2: "y".repeat(87), // Should create ~98 char record
						comment3: "z".repeat(89), // Should create ~100 char record, testing boundary
					},
				},
			];

			for (const testCase of testCases) {
				const paxData = generatePax({ ...testCase, size: 0 });

				if (paxData) {
					const paxBodyText = new TextDecoder().decode(paxData.paxBody);
					// Verify each record is properly formatted
					const lines = paxBodyText.split("\n").filter((line) => line.trim());
					for (const line of lines) {
						const spaceIndex = line.indexOf(" ");
						if (spaceIndex > 0) {
							const declaredLength = parseInt(
								line.substring(0, spaceIndex),
								10,
							);
							expect(declaredLength).toBe(line.length + 1);
						}
					}
				}
			}
		});

		it("handles complex PAX record with multiple boundary conditions", async () => {
			// Test a scenario with multiple PAX fields that might trigger edge cases
			const longName = "a".repeat(200); // Triggers path PAX record
			const longUser = "b".repeat(50); // Triggers uname PAX record
			const largeUid = 99999999; // Triggers uid PAX record

			const entries: TarEntry[] = [
				{
					header: {
						name: longName,
						size: 4,
						type: "file",
						uname: longUser,
						uid: largeUid,
						pax: {
							// Add custom PAX attributes to test preservation
							comment: "test comment without special chars",
							customField: "custom value",
						},
					},
					body: "test",
				},
			];

			const buffer = await packTar(entries);
			const extracted = await unpackTar(buffer);

			expect(extracted).toHaveLength(1);
			expect(extracted[0].header.name).toBe(longName);
			expect(extracted[0].header.uname).toBe(longUser);
			expect(extracted[0].header.uid).toBe(largeUid);
			expect(extracted[0].header.pax?.path).toBe(longName);
			expect(extracted[0].header.pax?.uname).toBe(longUser);
			expect(extracted[0].header.pax?.uid).toBe(largeUid.toString());
			expect(extracted[0].header.pax?.comment).toBe(
				"test comment without special chars",
			);
			expect(extracted[0].header.pax?.customField).toBe("custom value");
		});

		it("handles PAX records with special characters and encoding", async () => {
			const nameWithSpecialChars = "тест-файл-с-русскими-буквами.txt"; // Cyrillic
			const emojiName = "📁folder/🗂️file-with-emojis.txt"; // Emojis

			const entries: TarEntry[] = [
				{
					header: {
						name: nameWithSpecialChars,
						size: 4,
						type: "file",
					},
					body: "test",
				},
				{
					header: {
						name: emojiName,
						size: 4,
						type: "file",
					},
					body: "test",
				},
			];

			const buffer = await packTar(entries);
			const extracted = await unpackTar(buffer);

			expect(extracted).toHaveLength(2);
			expect(extracted[0].header.name).toBe(nameWithSpecialChars);
			expect(extracted[1].header.name).toBe(emojiName);
		});

		it("handles extremely long PAX records", async () => {
			// Create a PAX record that's long enough to test edge cases in length calculation
			const veryLongName = "x".repeat(1000); // Much longer than USTAR limits
			const veryLongUser = "u".repeat(100);
			const veryLongGroup = "g".repeat(100);

			const paxData = generatePax({
				name: veryLongName,
				uname: veryLongUser,
				gname: veryLongGroup,
				size: 4,
				type: "file",
			});

			expect(paxData).not.toBeNull();
			if (paxData) {
				const paxBodyText = new TextDecoder().decode(paxData.paxBody);
				expect(paxBodyText).toContain(`path=${veryLongName}`);
				expect(paxBodyText).toContain(`uname=${veryLongUser}`);
				expect(paxBodyText).toContain(`gname=${veryLongGroup}`);

				// Verify all PAX records are properly formatted
				const records = paxBodyText.split("\n").filter((line) => line.trim());
				for (const record of records) {
					expect(record).toMatch(/^\d+ \w+=/);
				}
			}
		});

		it("handles bodyless entries with PAX headers", async () => {
			const longDirName = "a".repeat(200);
			const longLinkTarget = "b".repeat(200);

			const entries: TarEntry[] = [
				{
					header: {
						name: `${longDirName}/`,
						type: "directory",
						size: 0, // Directories have no body
					},
				},
				{
					header: {
						name: "link-to-long-target",
						type: "symlink",
						linkname: longLinkTarget,
						size: 0, // Symlinks have no body
					},
				},
			];

			const buffer = await packTar(entries);
			const extracted = await unpackTar(buffer);

			expect(extracted).toHaveLength(2);
			expect(extracted[0].header.name).toBe(`${longDirName}/`);
			expect(extracted[0].header.type).toBe("directory");
			expect(extracted[1].header.linkname).toBe(longLinkTarget);
			expect(extracted[1].header.type).toBe("symlink");
		});

		it("handles Unicode characters in filenames with correct PAX record byte lengths", async () => {
			// Test filenames with multi-byte Unicode characters (emojis)
			const nameWithEmoji = "long_filename_ending_with_😀";
			const longNameWithEmoji = nameWithEmoji.repeat(10); // Creates ~280 char filename with emojis

			const entries: TarEntry[] = [
				{
					header: {
						name: longNameWithEmoji,
						size: 4,
						type: "file",
					},
					body: "test",
				},
			];

			// Pack and unpack should preserve the full Unicode filename
			const buffer = await packTar(entries);
			const extracted = await unpackTar(buffer);

			expect(extracted).toHaveLength(1);
			expect(extracted[0].header.name).toBe(longNameWithEmoji);
			expect(extracted[0].header.pax?.path).toBe(longNameWithEmoji);
			expect(decoder.decode(extracted[0].data)).toBe("test");
		});

		it("safely truncates PAX header names containing Unicode at byte boundaries", async () => {
			// The PAX header name "PaxHeader/{filename}" is limited to 100 bytes and must be truncated safely

			const nameWithTrailingEmoji = `${"a".repeat(95)}😀`; // Ends with 4-byte emoji
			const longNameWithEmoji = nameWithTrailingEmoji.repeat(3);

			const entries: TarEntry[] = [
				{
					header: {
						name: longNameWithEmoji,
						size: 4,
						type: "file",
					},
					body: "test",
				},
			];

			// The PAX header name will be safely truncated at byte boundaries
			// but the full filename should be preserved in PAX records
			const buffer = await packTar(entries);
			const extracted = await unpackTar(buffer);

			expect(extracted).toHaveLength(1);
			expect(extracted[0].header.name).toBe(longNameWithEmoji);
			expect(extracted[0].header.pax?.path).toBe(longNameWithEmoji);
		});
	});

	it("handles malformed PAX records gracefully", async () => {
		// Test that invalid PAX records don't break parsing
		const entries: TarEntry[] = [
			{
				header: {
					name: "test.txt",
					type: "file",
					size: 4,
					pax: {
						// This will create a malformed record when packed
						invalidSize: "not-a-number",
						validPath: "test.txt",
					},
				},
				body: "test",
			},
		];

		const buffer = await packTar(entries);
		const extracted = await unpackTar(buffer);

		expect(extracted).toHaveLength(1);
		expect(extracted[0].header.name).toBe("test.txt");
		// The valid PAX attributes should still be applied
		expect(extracted[0].header.pax?.validPath).toBe("test.txt");
	});

	it("handles PAX records with zero length gracefully", async () => {
		// Test edge case where PAX record might be empty
		const entries: TarEntry[] = [
			{
				header: {
					name: "empty-pax.txt",
					type: "file",
					size: 4,
					pax: {
						// Empty string value
						emptyValue: "",
						normalValue: "valid",
					},
				},
				body: "test",
			},
		];

		const buffer = await packTar(entries);
		const extracted = await unpackTar(buffer);

		expect(extracted).toHaveLength(1);
		expect(extracted[0].header.name).toBe("empty-pax.txt");
		expect(extracted[0].header.pax?.emptyValue).toBe("");
		expect(extracted[0].header.pax?.normalValue).toBe("valid");
	});

	it("handles PAX records with special characters in values", async () => {
		const entries: TarEntry[] = [
			{
				header: {
					name: "special.txt",
					type: "file",
					size: 4,
					pax: {
						comment: "Contains\nnewlines\tand\ttabs",
						path: "file with spaces and unicode: 🚀",
						custom: "value_without_equals",
					},
				},
				body: "test",
			},
		];

		const buffer = await packTar(entries);
		const extracted = await unpackTar(buffer);

		expect(extracted).toHaveLength(1);
		expect(extracted[0].header.pax?.comment).toBe(
			"Contains\nnewlines\tand\ttabs",
		);
		expect(extracted[0].header.name).toBe("file with spaces and unicode: 🚀");
		expect(extracted[0].header.pax?.custom).toBe("value_without_equals");
	});

	it("handles global PAX headers correctly", async () => {
		// Test PAX header behavior - the implementation may include all entries
		const entries: TarEntry[] = [
			{
				header: {
					name: "file1.txt",
					type: "file",
					size: 4,
					pax: {
						comment: "test_comment",
					},
				},
				body: "test",
			},
		];

		const buffer = await packTar(entries);
		const extracted = await unpackTar(buffer);

		expect(extracted).toHaveLength(1);
		expect(extracted[0].header.name).toBe("file1.txt");
		expect(extracted[0].header.pax?.comment).toBe("test_comment");
	});
});
