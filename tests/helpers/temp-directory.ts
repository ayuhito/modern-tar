import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, onTestFinished } from "vitest";

export function useTempDirectory(
	prefix: string,
	setDirectory: (directory: string) => void,
): void {
	beforeEach(async () => {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		onTestFinished(() => rm(directory, { recursive: true, force: true }));
		setDirectory(directory);
	});
}
