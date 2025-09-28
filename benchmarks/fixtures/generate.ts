import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURES_DIR = path.resolve(__dirname, "..", "data");
const SMALL_FILES_DIR = path.join(FIXTURES_DIR, "small-files");
const LARGE_FILES_DIR = path.join(FIXTURES_DIR, "large-files");
const NESTED_FILES_DIR = path.join(FIXTURES_DIR, "nested-files");

const SMALL_FILE_COUNT = 2500;
const SMALL_FILE_SIZE = 1024; // 1 KB
const LARGE_FILE_COUNT = 5;
const LARGE_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const NESTED_FILE_COUNT = 2500;
const NESTED_FILE_SIZE = 1024; // 1 KB (same as small files for fair comparison)

export async function generateFixtures() {
	console.log("Generating fixtures...");
	await fs.rm(FIXTURES_DIR, { recursive: true, force: true });

	// Many small files (flat structure)
	await fs.mkdir(SMALL_FILES_DIR, { recursive: true });
	const smallFileContent = Buffer.alloc(SMALL_FILE_SIZE, "a");
	const smallFilePromises: Promise<void>[] = [];
	for (let i = 0; i < SMALL_FILE_COUNT; i++) {
		smallFilePromises.push(
			fs.writeFile(
				path.join(SMALL_FILES_DIR, `file-${i}.txt`),
				smallFileContent,
			),
		);
	}
	await Promise.all(smallFilePromises);

	// Few large files (flat structure)
	await fs.mkdir(LARGE_FILES_DIR, { recursive: true });
	const largeFileContent = Buffer.alloc(LARGE_FILE_SIZE, "b");
	const largeFilePromises: Promise<void>[] = [];
	for (let i = 0; i < LARGE_FILE_COUNT; i++) {
		largeFilePromises.push(
			fs.writeFile(
				path.join(LARGE_FILES_DIR, `large-file-${i}.bin`),
				largeFileContent,
			),
		);
	}
	await Promise.all(largeFilePromises);

	// Nested directory structure for path normalization testing
	await fs.mkdir(NESTED_FILES_DIR, { recursive: true });
	const nestedFileContent = Buffer.alloc(NESTED_FILE_SIZE, "c");
	const nestedFilePromises: Promise<void>[] = [];

	// Create a variety of nested structures to test path normalization
	const structures = [
		// Simple nesting levels
		"level1",
		"level1/level2",
		"level1/level2/level3",
		"level1/level2/level3/level4",
		"level1/level2/level3/level4/level5",
		"level1/level2/level3/level4/level5/level6",

		// Category hierarchies
		"categories/audio",
		"categories/audio/music",
		"categories/audio/music/rock",
		"categories/audio/music/jazz",
		"categories/audio/podcasts",
		"categories/video",
		"categories/video/movies",
		"categories/video/tv-shows",
		"categories/documents",
		"categories/documents/legal",
		"categories/documents/financial",
		"categories/documents/personal",

		// Date-based structures
		"archive/2023/01/reports",
		"archive/2023/02/reports",
		"archive/2023/03/reports",
		"archive/2024/01/reports",
		"archive/2024/02/reports",

		// Project structures
		"projects/web-app/src/components",
		"projects/web-app/src/utils",
		"projects/web-app/tests/unit",
		"projects/web-app/tests/integration",
		"projects/mobile-app/ios/sources",
		"projects/mobile-app/android/sources",

		// Long paths for USTAR limits testing
		"very-long-directory-name-that-tests-path-limits-and-may-require-pax-extensions",
		"very-long-directory-name-that-tests-path-limits-and-may-require-pax-extensions/another-very-long-subdirectory-name-for-comprehensive-testing",
		"very-long-directory-name-that-tests-path-limits-and-may-require-pax-extensions/another-very-long-subdirectory-name-for-comprehensive-testing/even-deeper-nesting",

		// Special characters and edge cases
		"spaces in names",
		"spaces in names/more spaces here",
		"spaces in names/more spaces here/final level",
		"special-chars-!@#$%^&*()",
		"special-chars-!@#$%^&*()/nested-special",
		"dots.and.periods",
		"dots.and.periods/more.dots.here",
		"unicode-测试-🚀-directory",
		"unicode-测试-🚀-directory/nested-unicode-文件夹",
		"unicode-测试-🚀-directory/nested-unicode-文件夹/深层目录",

		// Mixed case and numbers
		"CamelCase",
		"CamelCase/mixedCase",
		"CamelCase/mixedCase/UPPERCASE",
		"numbers-123",
		"numbers-123/456-more",
		"numbers-123/456-more/789-final",

		// Hyphen and underscore variations
		"hyphen-separated",
		"hyphen-separated/more-hyphens",
		"underscore_separated",
		"underscore_separated/more_underscores",
		"mixed-style_naming",
		"mixed-style_naming/camelCase_mix",
	];

	// Create directories and distribute files across them
	for (const structure of structures) {
		const fullPath = path.join(NESTED_FILES_DIR, structure);
		await fs.mkdir(fullPath, { recursive: true });
	}

	// Distribute files across the nested structure
	for (let i = 0; i < NESTED_FILE_COUNT; i++) {
		const structure = structures[i % structures.length];
		const fileName = `nested-file-${i}.dat`;
		const filePath = path.join(NESTED_FILES_DIR, structure, fileName);

		nestedFilePromises.push(
			fs.writeFile(filePath, nestedFileContent)
		);
	}

	// Add some files with challenging names for path normalization
	const challengingNames = [
		"file with spaces.txt",
		"file-with-very-long-name-that-might-cause-issues-with-tar-format-limits-and-path-normalization.txt",
		"unicode-文件名-🎯.txt",
		"special!@#$%^&*()chars.txt",
		".hidden-file.txt",
		"..double-dot-file.txt",
		"normal.tar.gz.bz2.txt", // Extension confusion
	];

	for (const challengingName of challengingNames) {
		nestedFilePromises.push(
			fs.writeFile(
				path.join(NESTED_FILES_DIR, "level1", "level2", challengingName),
				nestedFileContent
			)
		);
	}

	await Promise.all(nestedFilePromises);

	console.log("Fixtures generated successfully.")
}
