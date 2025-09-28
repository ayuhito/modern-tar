import * as path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { packTar } from "modern-tar/fs";
import * as tar from "tar";
import * as tarfs from "tar-fs";

import { Bench } from "tinybench";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A writable stream that discards all data to measure pure throughput
function createNullStream() {
	return new Writable({
		write(_chunk, _encoding, callback) {
			callback();
		},
	});
}

const SMALL_FILES_DIR = path.resolve(__dirname, "data/small-files");
const LARGE_FILES_DIR = path.resolve(__dirname, "data/large-files");

export async function runPackingBenchmarks() {
	console.log("\nPacking benchmarks...");

	for (const testCase of [
		{ name: "Many Small Files (5000 x 1KB)", dir: SMALL_FILES_DIR },
		{ name: "Few Large Files (5 x 20MB)", dir: LARGE_FILES_DIR },
	]) {
		const bench = new Bench({
			time: 12000,
			iterations: 25,
			warmupTime: 3000,
			warmupIterations: 5,
		});

		bench
			.add(`modern-tar: ${testCase.name}`, async () => {
				await pipeline(packTar(testCase.dir), createNullStream());
			})
			.add(`node-tar: ${testCase.name}`, async () => {
				const stream = tar.c({ C: path.dirname(testCase.dir) }, [
					path.basename(testCase.dir),
				]);
				await pipeline(stream, createNullStream());
			})
			.add(`tar-fs: ${testCase.name}`, async () => {
				await pipeline(tarfs.pack(testCase.dir), createNullStream());
			});

		await bench.run();
		console.log(`\n--- ${testCase.name} ---`);
		console.table(bench.table());
	}
}
