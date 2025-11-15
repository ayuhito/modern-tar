import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { barplot, bench, group, run, summary } from "mitata";
import { packTar, unpackTar } from "modern-tar/fs";
import * as tar from "tar";
import * as tarFs from "tar-fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TMP_DIR = path.resolve(__dirname, "..", "tmp");
const TARBALLS_DIR = path.join(TMP_DIR, "tarballs");
const READ_CHUNK_SIZE = 256 * 1024; // 256KB buffer

const SMALL_FILES_DIR = path.resolve(__dirname, "data/small-files");
const LARGE_FILES_DIR = path.resolve(__dirname, "data/large-files");
const NESTED_FILES_DIR = path.resolve(__dirname, "data/nested-files");
const GIGANTIC_FILES_DIR = path.resolve(__dirname, "data/gigantic-files");
const LINK_TREE_DIR = path.resolve(__dirname, "data/link-tree");

const FIXTURE_SOURCES = [
	{ name: "small-files", dir: SMALL_FILES_DIR },
	{ name: "large-files", dir: LARGE_FILES_DIR },
	{ name: "nested-files", dir: NESTED_FILES_DIR },
	{ name: "gigantic-files", dir: GIGANTIC_FILES_DIR },
	{ name: "link-tree", dir: LINK_TREE_DIR },
] as const;

type BenchmarkCase = {
	name: string;
	file: string;
};

const BENCHMARK_CASES: BenchmarkCase[] = [
	{ name: "Many Small Files (2500 x 1KB)", file: "small-files.tar" },
	{
		name: "Many Small Nested Files (2500 x 1KB)",
		file: "nested-files.tar",
	},
	{ name: "Few Large Files (5 x 20MB)", file: "large-files.tar" },
	{
		name: "Huge Files (2 x 1GB)",
		file: "gigantic-files.tar",
	},
	{
		name: "Linked Small Files (500 packages, symlinks + hardlinks)",
		file: "link-tree.tar",
	},
];

async function setup() {
	await fsp.rm(TMP_DIR, { recursive: true, force: true });
	await fsp.mkdir(TARBALLS_DIR, { recursive: true });

	for (const testCase of FIXTURE_SOURCES) {
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

async function withTemporaryExtractDir(
	fn: (extractDir: string) => Promise<void>,
): Promise<void> {
	const extractDir = await createUniqueExtractDir();
	try {
		await fn(extractDir);
	} finally {
		await fsp.rm(extractDir, { recursive: true, force: true });
	}
}

export async function runUnpackingBenchmarks() {
	await setup();
	console.log("\nUnpacking benchmarks...");

	for (const testCase of BENCHMARK_CASES) {
		const tarballPath = path.join(TARBALLS_DIR, testCase.file);
		const datasetLabel = `${testCase.name}`;

		group(datasetLabel, () => {
			const registerBench = (
				label: string,
				fn: (extractDir: string) => Promise<void>,
			) =>
				bench(label, async () => {
					await withTemporaryExtractDir(async (extractDir) => {
						await fn(extractDir);
					});
				}).gc("inner");

			barplot(() => {
				summary(() => {
					registerBench(`modern-tar: ${testCase.name}`, async (extractDir) => {
						const readStream = fs.createReadStream(tarballPath, {
							highWaterMark: READ_CHUNK_SIZE,
						});
						const unpackStream = unpackTar(extractDir);
						await pipeline(readStream, unpackStream);
					});

					registerBench(`node-tar: ${testCase.name}`, async (extractDir) => {
						const readStream = fs.createReadStream(tarballPath, {
							highWaterMark: READ_CHUNK_SIZE,
						});
						const extractStream = tar.x({ cwd: extractDir });
						await pipeline(readStream, extractStream);
					});

					registerBench(`tar-fs: ${testCase.name}`, async (extractDir) => {
						const readStream = fs.createReadStream(tarballPath, {
							highWaterMark: READ_CHUNK_SIZE,
						});
						const extractStream = tarFs.extract(extractDir);
						await pipeline(readStream, extractStream);
					});
				});
			});
		});
	}

	await run({ format: { mitata: { name: "fixed" } } });
	await fsp.rm(TMP_DIR, { recursive: true, force: true });
}
