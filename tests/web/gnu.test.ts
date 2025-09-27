import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { FLAGTYPE, TYPEFLAG } from "../../src/web/constants";
import { unpackTar } from "../../src/web/index";
import { decoder } from "../../src/web/utils";
import { GNU_INCREMENTAL_TAR, GNU_LONG_PATH, GNU_TAR } from "./fixtures";

describe("GNU format support", () => {
	describe("basic GNU format", () => {
		it("extracts a gnu format tar", async () => {
			const buffer = await readFile(GNU_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const [entry] = entries;

			expect(entry.header.name).toBe("test.txt");
			expect(entry.header.size).toBe(14);
			expect(entry.header.uid).toBe(12345);
			expect(entry.header.gid).toBe(67890);
			expect(entry.header.uname).toBe("myuser");
			expect(entry.header.gname).toBe("mygroup");

			const content = decoder.decode(entry.data).trim();
			expect(content).toBe("Hello, world!");
		});

		it("correctly parses GNU incremental format archives", async () => {
			const buffer = await readFile(GNU_INCREMENTAL_TAR);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);
			const entry = entries[0];

			expect(entry.header.name).toBe("test.txt");
			expect(entry.header.type).toBe("file");
			expect(entry.header.uid).toBe(12345);
			expect(entry.header.gid).toBe(67890);
			expect(entry.header.uname).toBe("myuser");
			expect(entry.header.gname).toBe("mygroup");

			const content = decoder.decode(entry.data).trim();
			expect(content).toBe("Hello, world!");
		});
	});

	describe("GNU long filename support", () => {
		it("correctly parses GNU long path archives", async () => {
			const buffer = await readFile(GNU_LONG_PATH);
			const entries = await unpackTar(buffer);

			expect(entries).toHaveLength(1);

			const entry = entries[0];
			const expectedLongName =
				"node-v0.11.14/deps/npm/node_modules/init-package-json/node_modules/promzard/example/npm-init/init-input.js";

			// Verify the long filename was correctly parsed (not truncated)
			expect(entry.header.name).toBe(expectedLongName);
			expect(entry.header.name.length).toBeGreaterThan(100); // Exceeds USTAR limit
			expect(entry.header.type).toBe("file");

			// Verify file content is accessible
			const content = decoder.decode(entry.data);
			expect(content).toContain("var fs = require('fs')");
			expect(content).toContain("module.exports");
			expect(content).toContain("prompt('name'");
		});
	});
});
