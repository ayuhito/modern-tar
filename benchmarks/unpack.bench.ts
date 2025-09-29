import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { packTar, unpackTar } from "modern-tar/fs";
import * as tar from "tar";
import * as tarFs from "tar-fs";

import { Bench } from "tinybench";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TMP_DIR = path.resolve(__dirname, "..", "tmp");
const TARBALLS_DIR = path.join(TMP_DIR, "tarballs");

const SMALL_FILES_DIR = path.resolve(__dirname, "data/small-files");
const LARGE_FILES_DIR = path.resolve(__dirname, "data/large-files");
const NESTED_FILES_DIR = path.resolve(__dirname, "data/nested-files");

async function setup() {
	await fsp.rm(TMP_DIR, { recursive: true, force: true });
	await fsp.mkdir(TARBALLS_DIR, { recursive: true });

	for (const testCase of [
		{ name: "small-files", dir: SMALL_FILES_DIR },
		{ name: "large-files", dir: LARGE_FILES_DIR },
		{ name: "nested-files", dir: NESTED_FILES_DIR },
	]) {
		const tarballPath = path.join(TARBALLS_DIR, `${testCase.name}.tar`);
		const writeStream = fs.createWriteStream(tarballPath);
		await pipeline(packTar(testCase.dir), writeStream);
	}
}

async function createUniqueExtractDir(): Promise<string> {
	const extractDir = path.join(
		TMP_DIR,
		`extract-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await fsp.mkdir(extractDir, { recursive: true });
	return extractDir;
}

export async function runUnpackingBenchmarks() {
	await setup();
	console.log("\nUnpacking benchmarks...");

	for (const testCase of [
		{ name: "Many Small Files (2500 x 1KB)", file: "small-files.tar" },
		{ name: "Many Small Nested Files (2500 x 1KB)", file: "nested-files.tar" },
		{ name: "Few Large Files (5 x 20MB)", file: "large-files.tar" },
	]) {
		const tarballPath = path.join(TARBALLS_DIR, testCase.file);
		const bench = new Bench({
			time: 15000,
			iterations: 30,
			warmupTime: 5000,
			warmupIterations: 10,
		});

		let extractDir: string;

		bench
			.add(
				`modern-tar: Unpack ${testCase.name}`,
				async () => {
					const readStream = fs.createReadStream(tarballPath);
					const extractStream = unpackTar(extractDir);
					await pipeline(readStream, extractStream);
				},
				{
					async beforeEach() {
						extractDir = await createUniqueExtractDir();
					},
					async afterEach() {
						await fsp.rm(extractDir, { recursive: true, force: true });
					},
				},
			)
			.add(
				`node-tar: Unpack ${testCase.name}`,
				async () => {
					await tar.x({ f: tarballPath, C: extractDir });
				},
				{
					async beforeEach() {
						extractDir = await createUniqueExtractDir();
					},
					async afterEach() {
						await fsp.rm(extractDir, { recursive: true, force: true });
					},
				},
			)
			.add(
				`tar-fs: Unpack ${testCase.name}`,
				async () => {
					const readStream = fs.createReadStream(tarballPath);
					const extractStream = tarFs.extract(extractDir);
					await pipeline(readStream, extractStream);
				},
				{
					async beforeEach() {
						extractDir = await createUniqueExtractDir();
					},
					async afterEach() {
						await fsp.rm(extractDir, { recursive: true, force: true });
					},
				},
			);

		await bench.run();
		console.log(`\n--- ${testCase.name} ---`);
		console.table(bench.table());
	}

	await fsp.rm(TMP_DIR, { recursive: true, force: true });
}
