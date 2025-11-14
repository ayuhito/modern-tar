import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
	createGzipDecoder,
	createTarDecoder,
	type ParsedTarEntryWithData,
	unpackTar,
} from "../../src/web";
import { streamToBuffer } from "../../src/web/stream-utils";
import {
	ELECTRON_TGZ,
	LODASH_TGZ,
	NEXT_SWC_TGZ,
	NODE_V25_DARWIN_ARM64_TAR_GZ,
	SHARP_TGZ,
} from "./fixtures";

async function extractTgz(filePath: string): Promise<ParsedTarEntryWithData[]> {
	// @ts-expect-error ReadableStream.from is supported in Node tests
	const fileStream = ReadableStream.from(fs.createReadStream(filePath));

	const tarStream = fileStream.pipeThrough(createGzipDecoder());
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

	it(
		"extracts a massive native binary package (@next/swc)",
		{ timeout: 60000 },
		async () => {
			const entries = await extractTgz(NEXT_SWC_TGZ);

			const filesAndDirs = entries.filter(
				(e) => e.header.type === "file" || e.header.type === "directory",
			);
			expect(filesAndDirs.length).toBe(3);

			// Verify the massive binary file exists and is the correct size
			const binaryEntry = entries.find(
				(e) => e.header.name === "package/next-swc.linux-x64-gnu.node",
			);
			expect(binaryEntry).toBeDefined();
			expect(binaryEntry?.data?.length).toBe(131406240);

			// Verify package.json exists
			expect(
				entries.some((e) => e.header.name === "package/package.json"),
			).toBe(true);
		},
	);

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

	it("extracts a Node.js release tarball", async () => {
		// @ts-expect-error ReadableStream.from is supported in Node tests
		const fileStream = ReadableStream.from(
			fs.createReadStream(NODE_V25_DARWIN_ARM64_TAR_GZ),
		);

		const entryStream = fileStream
			.pipeThrough(createGzipDecoder())
			.pipeThrough(createTarDecoder());

		let count = 0;
		let lastEntry = "";
		let totalBytes = 0;
		for await (const entry of entryStream) {
			count++;
			lastEntry = entry.header.name;

			const reader = entry.body.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value) totalBytes += value.length;
			}
		}

		expect(count).toBe(5986);
		expect(lastEntry).toBe("node-v25.2.0-darwin-arm64/bin/npm");
		expect(totalBytes).toBe(200544142);
	});

	it("streams entries from the Node.js release tarball", async () => {
		// @ts-expect-error ReadableStream.from is supported in Node tests
		const fileStream = ReadableStream.from(
			fs.createReadStream(NODE_V25_DARWIN_ARM64_TAR_GZ),
		);

		const entryStream = fileStream
			.pipeThrough(createGzipDecoder())
			.pipeThrough(createTarDecoder());

		let count = 0;
		let lastEntry = "";
		for await (const entry of entryStream) {
			count++;
			lastEntry = entry.header.name;
			await entry.body.cancel();
		}

		expect(count).toBe(5986);
		expect(lastEntry).toBe("node-v25.2.0-darwin-arm64/bin/npm");
	});
});
