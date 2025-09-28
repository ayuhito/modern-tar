import { generateFixtures } from "./fixtures/generate.ts";
import { runPackingBenchmarks } from "./pack.bench.ts";
import { runUnpackingBenchmarks } from "./unpack.bench.ts";

async function main() {
	console.log("Starting benchmark run...");

	await generateFixtures();
	await runPackingBenchmarks();
	await runUnpackingBenchmarks();

	console.log("Benchmark run complete.");
}

main().catch((err) => {
	console.error("Benchmark failed:", err);
	process.exit(1);
});
