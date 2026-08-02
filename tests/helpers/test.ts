import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as baseTest } from "vitest";

// biome-ignore lint/correctness/noEmptyPattern: Vitest requires fixture context destructuring.
export const it = baseTest.extend("tempDir", async ({}, { onCleanup }) => {
	const tempDir = await mkdtemp(join(tmpdir(), "modern-tar-test-"));
	onCleanup(() => rm(tempDir, { recursive: true, force: true }));
	return tempDir;
});
