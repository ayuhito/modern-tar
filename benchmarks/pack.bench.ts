import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { barplot, bench, group, run, summary } from "mitata";
import { packTar } from "modern-tar/fs";
import * as tar from "tar";
import * as tarfs from "tar-fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TMP_DIR = path.resolve(__dirname, "..", "tmp");
const TARBALLS_DIR = path.join(TMP_DIR, "tarballs");

const SMALL_FILES_DIR = path.resolve(__dirname, "data/small-files");
const LARGE_FILES_DIR = path.resolve(__dirname, "data/large-files");
const NESTED_FILES_DIR = path.resolve(__dirname, "data/nested-files");
const GIGANTIC_FILES_DIR = path.resolve(__dirname, "data/gigantic-files");

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

async function withTemporaryTarball(
	fn: (tarballPath: string) => Promise<void>,
): Promise<void> {
	const tarballPath = createUniqueTarballPath();
	try {
		await fn(tarballPath);
	} finally {
		await fsp.rm(tarballPath, { force: true });
	}
}

export async function runPackingBenchmarks() {
	await setup();
	console.log("\nPacking benchmarks...");

	for (const testCase of [
		{ name: "Many Small Files (2500 x 1KB)", dir: SMALL_FILES_DIR },
		{ name: "Many Small Nested Files (2500 x 1KB)", dir: NESTED_FILES_DIR },
		{ name: "Few Large Files (5 x 20MB)", dir: LARGE_FILES_DIR },
		{ name: "Huge Files (2 x 1GB)", dir: GIGANTIC_FILES_DIR },
	]) {
		group(testCase.name, () => {
			const registerBench = (
				label: string,
				fn: (tarballPath: string) => Promise<void>,
			) =>
				bench(label, async () => {
					await withTemporaryTarball(async (tarballPath) => {
						await fn(tarballPath);
					});
				}).gc("inner");

			barplot(() => {
				summary(() => {
					registerBench(`modern-tar: ${testCase.name}`, async (tarballPath) => {
						const writeStream = fs.createWriteStream(tarballPath);
						await pipeline(packTar(testCase.dir), writeStream);
					});

					registerBench(`node-tar: ${testCase.name}`, async (tarballPath) => {
						await tar.c(
							{
								file: tarballPath,
								C: path.dirname(testCase.dir),
							},
							[path.basename(testCase.dir)],
						);
					});

					registerBench(`tar-fs: ${testCase.name}`, async (tarballPath) => {
						const writeStream = fs.createWriteStream(tarballPath);
						await pipeline(tarfs.pack(testCase.dir), writeStream);
					});
				});
			});
		});
	}

	await run({ format: { mitata: { name: "fixed" } } });
	await teardown();
}
