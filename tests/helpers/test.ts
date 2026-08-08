import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as baseTest } from "vitest";

// biome-ignore lint/correctness/noEmptyPattern: Vitest requires fixture context destructuring.
export const it = baseTest.extend("tmpDir", async ({}, { onCleanup }) => {
	const tmpDir = await mkdtemp(join(tmpdir(), "modern-tar-test-"));
	onCleanup(() =>
		rm(tmpDir, {
			recursive: true,
			force: true,
			maxRetries: 3,
			retryDelay: 100,
		}),
	);
	return tmpDir;
});
