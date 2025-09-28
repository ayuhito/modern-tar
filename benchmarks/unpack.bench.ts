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
const EXTRACT_DIR = path.join(TMP_DIR, "extract");

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

async function cleanup() {
	await fsp.rm(EXTRACT_DIR, { recursive: true, force: true });
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
			time: 12000,
			iterations: 25,
			warmupTime: 3000,
			warmupIterations: 5,
		});

		bench
			.add(`modern-tar: Unpack ${testCase.name}`, async () => {
				const readStream = fs.createReadStream(tarballPath);
				const extractStream = unpackTar(EXTRACT_DIR);
				await pipeline(readStream, extractStream);
			})
			.add(`node-tar: Unpack ${testCase.name}`, async () => {
				// Use node-tar's high-level extraction API
				await tar.x({ f: tarballPath, C: EXTRACT_DIR });
			})
			.add(`tar-fs: Unpack ${testCase.name}`, async () => {
				const readStream = fs.createReadStream(tarballPath);
				const extractStream = tarFs.extract(EXTRACT_DIR);
				await pipeline(readStream, extractStream);
			});

		// Clean up extraction directory before each run
		await cleanup();
		await fsp.mkdir(EXTRACT_DIR, { recursive: true });

		await bench.run();
		console.log(`\n--- Unpack ${testCase.name} ---`);
		console.table(bench.table());

		// Clean up after benchmark
		await cleanup();
	}
}
