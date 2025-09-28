import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURES_DIR = path.resolve(__dirname, "..", "data");
const SMALL_FILES_DIR = path.join(FIXTURES_DIR, "small-files");
const LARGE_FILES_DIR = path.join(FIXTURES_DIR, "large-files");

const SMALL_FILE_COUNT = 5000;
const SMALL_FILE_SIZE = 1024; // 1 KB
const LARGE_FILE_COUNT = 5;
const LARGE_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export async function generateFixtures() {
	console.log("Generating fixtures...");
	await fs.rm(FIXTURES_DIR, { recursive: true, force: true });

	// Many small files
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

	// Few large files
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

	console.log("Fixtures generated successfully.");
}
