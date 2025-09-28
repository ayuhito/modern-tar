import { generateFixtures } from "./fixtures/generate.ts";
import { runUnpackingBenchmarks } from "./unpack.bench.ts";

async function main() {
	console.log("Starting unpacking benchmark run...\n");

	await generateFixtures();
	await runUnpackingBenchmarks();

	console.log("Unpacking benchmark run complete.");
}

main().catch((err) => {
	console.error("Unpacking benchmark failed:", err);
	process.exit(1);
});
