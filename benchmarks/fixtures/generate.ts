import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURES_DIR = path.resolve(__dirname, "..", "data");
const SMALL_FILES_DIR = path.join(FIXTURES_DIR, "small-files");
const LARGE_FILES_DIR = path.join(FIXTURES_DIR, "large-files");
const NESTED_FILES_DIR = path.join(FIXTURES_DIR, "nested-files");
const GIGANTIC_FILES_DIR = path.join(FIXTURES_DIR, "gigantic-files");
const LINK_TREE_DIR = path.join(FIXTURES_DIR, "link-tree");

const SMALL_FILE_COUNT = 2500;
const SMALL_FILE_SIZE = 1024; // 1 KB
const LARGE_FILE_COUNT = 5;
const LARGE_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const NESTED_FILE_COUNT = 2500;
const NESTED_FILE_SIZE = 1024; // 1 KB
const GIGANTIC_FILE_COUNT = 2;
const GIGANTIC_FILE_SIZE = 1024 * 1024 * 1024; // 1 GB
const LINK_TREE_PACKAGE_COUNT = 500;
const LINK_TREE_FILE_SIZE = 1024; // 1 KB

export async function generateFixtures() {
	console.log("Generating fixtures...");
	await fs.rm(FIXTURES_DIR, { recursive: true, force: true });

	await createSmallFiles();
	await createLargeFiles();
	await createNestedFilesFixture();
	await createGiganticFiles();

	// Link-heavy workspace (symlinks + hardlinks).
	await createLinkTreeFixture();

	console.log("Fixtures generated successfully.");
}

async function createSmallFiles() {
	await fs.mkdir(SMALL_FILES_DIR, { recursive: true });
	const content = Buffer.alloc(SMALL_FILE_SIZE, "a");
	const writes: Promise<void>[] = [];

	for (let i = 0; i < SMALL_FILE_COUNT; i++) {
		const filePath = path.join(SMALL_FILES_DIR, `file-${i}.txt`);
		writes.push(fs.writeFile(filePath, content));
	}

	await Promise.all(writes);
}

async function createLargeFiles() {
	await fs.mkdir(LARGE_FILES_DIR, { recursive: true });
	const content = Buffer.alloc(LARGE_FILE_SIZE, "b");
	const writes: Promise<void>[] = [];

	for (let i = 0; i < LARGE_FILE_COUNT; i++) {
		const filePath = path.join(LARGE_FILES_DIR, `large-file-${i}.bin`);
		writes.push(fs.writeFile(filePath, content));
	}

	await Promise.all(writes);
}

async function createNestedFilesFixture() {
	await fs.mkdir(NESTED_FILES_DIR, { recursive: true });
	const nestedFileContent = Buffer.alloc(NESTED_FILE_SIZE, "c");

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

	for (const structure of structures) {
		await fs.mkdir(path.join(NESTED_FILES_DIR, structure), { recursive: true });
	}

	const distributedWrites: Promise<void>[] = [];
	for (let i = 0; i < NESTED_FILE_COUNT; i++) {
		const structure = structures[i % structures.length];
		const filePath = path.join(
			NESTED_FILES_DIR,
			structure,
			`nested-file-${i}.dat`,
		);
		distributedWrites.push(fs.writeFile(filePath, nestedFileContent));
	}
	await Promise.all(distributedWrites);

	const challengingNames = [
		"file with spaces.txt",
		"file-with-very-long-name-that-might-cause-issues-with-tar-format-limits-and-path-normalization.txt",
		"unicode-文件名-🎯.txt",
		"special!@#$%^&*()chars.txt",
		".hidden-file.txt",
		"..double-dot-file.txt",
		"normal.tar.gz.bz2.txt", // Extension confusion
	];

	await Promise.all(
		challengingNames.map((name) =>
			fs.writeFile(
				path.join(NESTED_FILES_DIR, "level1", "level2", name),
				nestedFileContent,
			),
		),
	);
}

async function createGiganticFiles() {
	await fs.mkdir(GIGANTIC_FILES_DIR, { recursive: true });

	for (let i = 0; i < GIGANTIC_FILE_COUNT; i++) {
		const filePath = path.join(GIGANTIC_FILES_DIR, `gigantic-file-${i}.bin`);
		await createLargeFile(filePath, GIGANTIC_FILE_SIZE);
	}
}

async function createLargeFile(
	filePath: string,
	sizeBytes: number,
) {
	const handle = await fs.open(filePath, "w");
	const chunkSize = 16 * 1024 * 1024; // 16 MB
	const chunk = Buffer.alloc(chunkSize, "L");

	try {
		let bytesLeft = sizeBytes;
		while (bytesLeft > 0) {
			const currentChunk =
				bytesLeft >= chunk.length ? chunk : chunk.subarray(0, bytesLeft);
			await handle.write(currentChunk);
			bytesLeft -= currentChunk.length;
		}
	} finally {
		await handle.close();
	}
}

async function createLinkTreeFixture() {
	await fs.mkdir(LINK_TREE_DIR, { recursive: true });

	const workspaceRoot = path.join(LINK_TREE_DIR, "workspace");
	const workspaceNodeModules = path.join(workspaceRoot, "node_modules");
	const workspaceBinDir = path.join(workspaceNodeModules, ".bin");
	const virtualStoreDir = path.join(workspaceNodeModules, ".virtual-store");
	const storeDir = path.join(LINK_TREE_DIR, "virtual-store");

	await Promise.all([
		fs.mkdir(workspaceNodeModules, { recursive: true }),
		fs.mkdir(workspaceBinDir, { recursive: true }),
		fs.mkdir(virtualStoreDir, { recursive: true }),
		fs.mkdir(storeDir, { recursive: true }),
	]);

	const makeSymlink = async (
		targetPath: string,
		linkPath: string,
		type: "file" | "junction" = "file",
	) => {
		const linkDir = path.dirname(linkPath);
		await fs.mkdir(linkDir, { recursive: true });
		const relativeTarget = path.relative(linkDir, targetPath) || ".";
		await fs.symlink(relativeTarget, linkPath, type);
	};

	const packages = Array.from({ length: LINK_TREE_PACKAGE_COUNT }, (_, index) => ({
		name: `linkpkg-${index.toString().padStart(4, "0")}`,
		version: `1.0.${index}`,
		description: "virtual-store link tree test package",
	}));

	for (let i = 0; i < packages.length; i++) {
		const pkg = packages[i];
		const pkgKey = `${pkg.name}@${pkg.version}`;
		const storePackageDir = path.join(storeDir, pkgKey);

		await fs.mkdir(storePackageDir, { recursive: true });
		await fs.mkdir(path.join(storePackageDir, "lib"), { recursive: true });
		await fs.mkdir(path.join(storePackageDir, "bin"), { recursive: true });
		await fs.mkdir(path.join(storePackageDir, "data"), { recursive: true });

		const payload = Buffer.alloc(
			LINK_TREE_FILE_SIZE,
			String.fromCharCode(97 + (i % 26)),
		);

		await fs.writeFile(
			path.join(storePackageDir, "package.json"),
			JSON.stringify(
				{
					name: pkg.name,
					version: pkg.version,
					description: pkg.description,
					main: "index.js",
					bin: {
						[pkg.name]: "./bin/cli.js",
					},
					files: ["lib", "bin", "index.js", "data"],
				},
				null,
				2,
			),
		);
		await fs.writeFile(
			path.join(storePackageDir, "index.js"),
			`exports.name = "${pkg.name}";\nexports.version = "${pkg.version}";\n`,
		);
		await fs.writeFile(
			path.join(storePackageDir, "lib", "index.js"),
			`module.exports = function greet() {\n  return "${pkg.name}::${pkg.version}";\n};\n`,
		);
		await fs.writeFile(
			path.join(storePackageDir, "README.md"),
			`# ${pkg.name}\n\n${pkg.description} (${i})\n`,
		);
		await fs.writeFile(
			path.join(storePackageDir, "data", `payload-${i}.bin`),
			payload,
		);
		await fs.writeFile(
			path.join(storePackageDir, "bin", "cli.js"),
			`#!/usr/bin/env node\nconsole.log("${pkg.name} cli");\n`,
			{ mode: 0o755 },
		);

		const virtualStorePackageDir = path.join(
			virtualStoreDir,
			pkgKey,
			"node_modules",
			pkg.name,
		);
		await makeSymlink(storePackageDir, virtualStorePackageDir, "junction");

		const workspacePackageLink = path.join(workspaceNodeModules, pkg.name);
		await makeSymlink(virtualStorePackageDir, workspacePackageLink, "junction");

		const binTarget = path.join(virtualStorePackageDir, "bin", "cli.js");
		const binLink = path.join(workspaceBinDir, pkg.name);
		await makeSymlink(binTarget, binLink, "file");
	}
}
