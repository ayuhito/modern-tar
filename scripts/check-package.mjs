import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	checkPackage,
	createPackageFromTarballData,
} from "@arethetypeswrong/core";
import { publint } from "publint";
import { formatMessage } from "publint/utils";

const [tarballArgument] = process.argv
	.slice(2)
	.filter((argument) => argument !== "--");

if (!tarballArgument) {
	throw new Error("Usage: node scripts/check-package.mjs <tarball>");
}

const tarballPath = resolve(tarballArgument);
const tarball = await readFile(tarballPath);
const tarballArrayBuffer = tarball.buffer.slice(
	tarball.byteOffset,
	tarball.byteOffset + tarball.byteLength,
);

const [publintResult, typesResult] = await Promise.all([
	publint({ level: "warning", pack: { tarball: tarballArrayBuffer } }),
	checkPackage(createPackageFromTarballData(tarball)),
]);

const failures = publintResult.messages.map(
	(message) =>
		`publint: ${formatMessage(message, publintResult.pkg, { color: false }) ?? message.code}`,
);

if (!typesResult.types) {
	failures.push("arethetypeswrong: package has no types");
} else {
	for (const problem of typesResult.problems) {
		if (
			"resolutionKind" in problem &&
			["node10", "node16-cjs"].includes(problem.resolutionKind)
		) {
			continue;
		}

		failures.push(
			`arethetypeswrong: ${problem.kind}${
				"entrypoint" in problem ? ` at ${problem.entrypoint}` : ""
			}${"resolutionKind" in problem ? ` (${problem.resolutionKind})` : ""}`,
		);
	}
}

if (failures.length > 0) {
	throw new Error(`Package validation failed:\n${failures.join("\n")}`);
}

console.log(`Package validation passed for ${tarballPath}`);
