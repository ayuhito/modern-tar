import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function writeTree(
	root: string,
	files: Record<string, string | Uint8Array>,
) {
	await mkdir(root, { recursive: true });
	await Promise.all(
		Object.entries(files).map(async ([name, content]) => {
			const file = join(root, name);
			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, content);
		}),
	);
	return root;
}
