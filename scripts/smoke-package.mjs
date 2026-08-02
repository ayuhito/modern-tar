import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const [, , tarballArgument, runtimeArgument = process.execPath] = process.argv;

if (!tarballArgument) {
	throw new Error("Usage: node scripts/smoke-package.mjs <tarball> [runtime]");
}

const tarball = resolve(tarballArgument);
const runtime = resolveRuntime(runtimeArgument);
const consumerDirectory = await mkdtemp(join(tmpdir(), "modern-tar-consumer-"));

try {
	const npmCli = await findNpmCli();
	await writeFile(
		join(consumerDirectory, "package.json"),
		JSON.stringify({ private: true, type: "module" }),
	);
	await run(
		process.execPath,
		[
			npmCli,
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--package-lock=false",
			tarball,
		],
		consumerDirectory,
	);
	await writeFile(
		join(consumerDirectory, "smoke.mjs"),
		`import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { packTar, unpackTar } from "modern-tar";
import { packTar as packTarFs, unpackTar as unpackTarFs } from "modern-tar/fs";

const archive = await packTar([{
  header: {
    name: "hello.txt",
    size: 5,
    mode: 0o644,
    uid: 0,
    gid: 0,
    mtime: new Date(0),
  },
  body: "hello",
}]);
const [entry] = await unpackTar(archive);

assert.equal(entry.header.name, "hello.txt");
assert.equal(new TextDecoder().decode(entry.data), "hello");

const extractionDirectory = await mkdtemp(join(tmpdir(), "modern-tar-fs-"));
try {
  const chunks = [];
  for await (const chunk of packTarFs([{
    type: "content",
    target: "nested/hello.txt",
    content: "filesystem",
  }])) {
    chunks.push(chunk);
  }
  await pipeline(Readable.from(chunks), unpackTarFs(extractionDirectory));
  assert.equal(
    await readFile(join(extractionDirectory, "nested/hello.txt"), "utf8"),
    "filesystem",
  );
} finally {
  await rm(extractionDirectory, { recursive: true, force: true });
}
`,
	);
	await run(runtime, ["smoke.mjs"], consumerDirectory);
} finally {
	await rm(consumerDirectory, { recursive: true, force: true });
}

function resolveRuntime(argument) {
	if (argument === "node") return process.execPath;
	if (argument === "bun")
		return process.platform === "win32" ? "bun.exe" : "bun";
	return argument;
}

async function findNpmCli() {
	const executableDirectory = dirname(process.execPath);
	const candidates = [
		resolve(executableDirectory, "../lib/node_modules/npm/bin/npm-cli.js"),
		resolve(executableDirectory, "node_modules/npm/bin/npm-cli.js"),
	];

	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next layout used by official Node distributions.
		}
	}

	throw new Error(`Could not find npm bundled with ${process.execPath}`);
}

function run(command, arguments_, cwd) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, arguments_, { cwd, stdio: "inherit" });
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
