import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { packTar } from "modern-tar/fs";
import * as tar from "tar";
import * as tarfs from "tar-fs";

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
}

async function teardown() {
	await fsp.rm(TMP_DIR, { recursive: true, force: true });
}

function createUniqueTarballPath(): string {
	return path.join(
		TARBALLS_DIR,
		`pack-${Date.now()}-${Math.random().toString(36).slice(2)}.tar`,
	);
}

export async function runPackingBenchmarks() {
	await setup();
	console.log("\nPacking benchmarks...");

	for (const testCase of [
		{ name: "Many Small Files (2500 x 1KB)", dir: SMALL_FILES_DIR },
		{ name: "Many Small Nested Files (2500 x 1KB)", dir: NESTED_FILES_DIR },
		{ name: "Few Large Files (5 x 20MB)", dir: LARGE_FILES_DIR },
	]) {
		const bench = new Bench({
			time: 15000,
			iterations: 30,
			warmupTime: 5000,
			warmupIterations: 10,
		});

		let uniqueTarballPath: string;

		bench
			.add(
				`modern-tar: Pack ${testCase.name}`,
				async () => {
					const writeStream = fs.createWriteStream(uniqueTarballPath);
					await pipeline(packTar(testCase.dir), writeStream);
				},
				{
					beforeEach() {
						uniqueTarballPath = createUniqueTarballPath();
					},
					async afterEach() {
						await fsp.rm(uniqueTarballPath, { force: true });
					},
				},
			)
			.add(
				`node-tar: Pack ${testCase.name}`,
				async () => {
					await tar.c(
						{
							file: uniqueTarballPath,
							C: path.dirname(testCase.dir),
						},
						[path.basename(testCase.dir)],
					);
				},
				{
					beforeEach() {
						uniqueTarballPath = createUniqueTarballPath();
					},
					async afterEach() {
						await fsp.rm(uniqueTarballPath, { force: true });
					},
				},
			)
			.add(
				`tar-fs: Pack ${testCase.name}`,
				async () => {
					const writeStream = fs.createWriteStream(uniqueTarballPath);
					await pipeline(tarfs.pack(testCase.dir), writeStream);
				},
				{
					beforeEach() {
						uniqueTarballPath = createUniqueTarballPath();
					},
					async afterEach() {
						await fsp.rm(uniqueTarballPath, { force: true });
					},
				},
			);

		await bench.run();
		console.log(`\n--- ${testCase.name} ---`);
		console.table(bench.table());
	}

	await teardown();
}
