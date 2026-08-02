import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { type ParsedTarEntryWithData, unpackTar } from "../../src/web";
import { streamToBuffer } from "../../src/web/stream-utils";
import { ELECTRON_TGZ, LODASH_TGZ, SHARP_TGZ } from "./fixtures";

async function extractTgz(filePath: string): Promise<ParsedTarEntryWithData[]> {
	// @ts-expect-error ReadableStream.from is supported in Node tests
	const fileStream = ReadableStream.from(fs.createReadStream(filePath));

	const tarStream = fileStream.pipeThrough(new DecompressionStream("gzip"));
	const tarBuffer = await streamToBuffer(tarStream);

	return unpackTar(tarBuffer);
}

describe("real world examples", () => {
	it("extracts a real-world npm package (lodash)", async () => {
		const entries = await extractTgz(LODASH_TGZ);

		const filesAndDirs = entries.filter(
			(e) => e.header.type === "file" || e.header.type === "directory",
		);
		expect(filesAndDirs.length).toBe(1054);

		// Verify a known file exists
		const readmeEntry = entries.find(
			(e) => e.header.name === "package/README.md",
		);
		expect(readmeEntry).toBeDefined();
		expect(readmeEntry?.data?.length).toBe(1107);
	});

	it("extracts a native C++ package with build files (sharp)", async () => {
		const entries = await extractTgz(SHARP_TGZ);

		const filesAndDirs = entries.filter(
			(e) => e.header.type === "file" || e.header.type === "directory",
		);
		expect(filesAndDirs.length).toBe(32);

		// Verify C++ source files exist
		const cppFiles = entries.filter(
			(e) => e.header.name.endsWith(".cc") || e.header.name.endsWith(".h"),
		);
		expect(cppFiles.length).toBe(13);

		// Verify a specific C++ file has substantial content
		const sharpCcEntry = entries.find(
			(e) => e.header.name === "package/src/sharp.cc",
		);
		expect(sharpCcEntry).toBeDefined();
		expect(sharpCcEntry?.data?.length).toBe(1465);
	});

	it("extracts a package with installation scripts (electron)", async () => {
		const entries = await extractTgz(ELECTRON_TGZ);

		const filesAndDirs = entries.filter(
			(e) => e.header.type === "file" || e.header.type === "directory",
		);
		expect(filesAndDirs.length).toBe(8);

		// Verify key files exist
		expect(entries.some((e) => e.header.name === "package/install.js")).toBe(
			true,
		);
		expect(entries.some((e) => e.header.name === "package/cli.js")).toBe(true);
		expect(
			entries.some((e) => e.header.name === "package/checksums.json"),
		).toBe(true);

		// Verify TypeScript definitions exist and have content
		const electronDtsEntry = entries.find(
			(e) => e.header.name === "package/electron.d.ts",
		);
		expect(electronDtsEntry).toBeDefined();
		expect(electronDtsEntry?.data?.length).toBe(987499);
	});
});
