import { generateFixtures } from "./fixtures/generate.ts";
import { runPackingBenchmarks } from "./pack.bench.ts";

async function main() {
	console.log("Starting packing benchmark run...\n");

	await generateFixtures();
	await runPackingBenchmarks();

	console.log("Packing benchmark run complete.");
}

main().catch((err) => {
	console.error("Packing benchmark failed:", err);
	process.exit(1);
});
