import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumerDirectory = await mkdtemp(
	join(tmpdir(), "modern-tar-typescript-5-7-"),
);

try {
	const modulesDirectory = join(consumerDirectory, "node_modules");
	const nodeTypesSource = await realpath(
		join(repository, "node_modules/node-types-18"),
	);
	const nodeTypesDependencies = resolve(nodeTypesSource, "../..");

	await mkdir(join(modulesDirectory, "@types"), { recursive: true });
	await cp(nodeTypesSource, join(modulesDirectory, "@types/node"), {
		recursive: true,
		dereference: true,
	});
	await cp(
		join(nodeTypesDependencies, "undici-types"),
		join(modulesDirectory, "undici-types"),
		{ recursive: true, dereference: true },
	);
	await mkdir(join(modulesDirectory, "modern-tar"), { recursive: true });
	await cp(
		join(repository, "dist"),
		join(modulesDirectory, "modern-tar/dist"),
		{ recursive: true },
	);
	await cp(
		join(repository, "package.json"),
		join(modulesDirectory, "modern-tar/package.json"),
	);
	await cp(
		join(repository, "tests/package/consumer.ts"),
		join(consumerDirectory, "consumer.ts"),
	);
	await writeFile(
		join(consumerDirectory, "package.json"),
		JSON.stringify({ private: true, type: "module" }),
	);
	await writeFile(
		join(consumerDirectory, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				module: "NodeNext",
				moduleResolution: "NodeNext",
				strict: true,
				noEmit: true,
				skipLibCheck: false,
				types: ["node"],
			},
			files: ["consumer.ts"],
		}),
	);
	await run(process.execPath, [
		join(repository, "node_modules/typescript-5-7/bin/tsc"),
		"--project",
		join(consumerDirectory, "tsconfig.json"),
	]);
} finally {
	await rm(consumerDirectory, { recursive: true, force: true });
}

function run(command, arguments_) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, arguments_, {
			cwd: consumerDirectory,
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			reject(
				new Error(
					`${command} ${arguments_.join(" ")} failed with ${signal ?? `exit code ${code}`}`,
				),
			);
		});
	});
}
