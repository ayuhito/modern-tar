import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect } from "vitest";
import { unpackTar } from "../../../src/fs";
import { encoder } from "../../../src/tar/encoding";
import { packTar, type TarEntry } from "../../../src/web";
import { it } from "../../helpers/test";
import { INVALID_TAR } from "../../web/fixtures";

describe("archive hardening", () => {
	describe("malformed archives", () => {
		it.skipIf(process.platform === "win32")(
			"rejects unpacking a tar with an invalid symlink pointing outside",
			async ({ tmpDir }) => {
				const extractDir = path.join(tmpDir, "extracted");
				await fs.mkdir(extractDir, { recursive: true });

				const readStream = createReadStream(INVALID_TAR);
				const unpackStream = unpackTar(extractDir);

				// This fixture contains a symlink 'foo' -> '../' which is a traversal attempt.
				await expect(pipeline(readStream, unpackStream)).rejects.toThrow(
					'Symlink "../" points outside the extraction directory.',
				);
			},
		);
	});
	it("prevents alignment DoS vulnerability in isZeroBlock", async ({
		tmpDir,
	}) => {
		// Verifies that unaligned data chunks don't cause RangeError crashes
		const extractDir = path.join(tmpDir, "extract");
		await fs.mkdir(extractDir, { recursive: true });

		const entries: TarEntry[] = [
			{
				header: { name: "test.txt", type: "file", size: 4 },
				body: "test",
			},
		];

		const tarBuffer = await packTar(entries);

		// Test unaligned chunking that would crash vulnerable version
		let sent = false;
		const unalignedStream = new Readable({
			read() {
				if (!sent) {
					this.push(tarBuffer.subarray(0, 513)); // Unaligned chunk
					this.push(tarBuffer.subarray(513));
					this.push(null);
					sent = true;
				}
			},
		});

		const unpackStream = unpackTar(extractDir);
		await expect(
			pipeline(unalignedStream, unpackStream),
		).resolves.not.toThrow();

		const content = await fs.readFile(
			path.join(extractDir, "test.txt"),
			"utf8",
		);
		expect(content).toBe("test");
	});

	describe("prototype pollution via PAX headers", () => {
		it("should NOT pollute prototype via PAX headers", async ({ tmpDir }) => {
			const destDir = path.join(tmpDir, "extracted");
			await fs.mkdir(destDir, { recursive: true });

			// Manually construct a malicious PAX header
			const paxBody = encoder.encode("21 __proto__=polluted\n");
			const headerBlock = new Uint8Array(512);

			// Write name "pax-header"
			headerBlock.set(encoder.encode("pax-header"), 0);
			// Write mode 644
			headerBlock.set(encoder.encode("0000644\0"), 100);
			// Write uid 0
			headerBlock.set(encoder.encode("0000000\0"), 108);
			// Write gid 0
			headerBlock.set(encoder.encode("0000000\0"), 116);
			// Write size (octal)
			const sizeStr = `${paxBody.length.toString(8).padStart(11, "0")}\0`;
			headerBlock.set(encoder.encode(sizeStr), 124);
			// Write mtime
			headerBlock.set(encoder.encode("00000000000\0"), 136);
			// Write chksum (blanks first)
			headerBlock.set(encoder.encode("        "), 148);
			// Write typeflag 'x' (PAX)
			headerBlock.set(encoder.encode("x"), 156);
			// Write magic "ustar\0"
			headerBlock.set(encoder.encode("ustar\0"), 257);
			// Write version "00"
			headerBlock.set(encoder.encode("00"), 263);

			// Calculate checksum
			let checksum = 0;
			for (let i = 0; i < 512; i++) checksum += headerBlock[i];
			const checksumStr = `${checksum.toString(8).padStart(6, "0")}\0 `;
			headerBlock.set(encoder.encode(checksumStr), 148);

			// Pad body to 512 bytes
			const paddedBody = new Uint8Array(512);
			paddedBody.set(paxBody);

			const tarBuffer = Buffer.concat([headerBlock, paddedBody]);

			const unpackStream = unpackTar(destDir);
			await pipeline(Readable.from([tarBuffer]), unpackStream);

			// Check for pollution
			// @ts-expect-error
			expect({}.polluted).toBeUndefined();
			// @ts-expect-error
			expect(Object.prototype.polluted).toBeUndefined();
		});
	});

	describe("privilege escalation prevention", () => {
		it("should strip SUID/SGID bits from extracted files", async ({
			tmpDir,
		}) => {
			const destDir = path.join(tmpDir, "suid-check");
			await fs.mkdir(destDir, { recursive: true });

			const entries: TarEntry[] = [
				{
					header: {
						name: "suid-file",
						size: 0,
						type: "file",
						// 0o4755 = SUID + rwxr-xr-x
						mode: 0o4755,
					},
					body: "",
				},
			];

			const tarBuffer = await packTar(entries);
			const unpackStream = unpackTar(destDir);
			await pipeline(Readable.from([tarBuffer]), unpackStream);

			const stats = await fs.stat(path.join(destDir, "suid-file"));

			// Verify SUID bit is stripped (0o4000)
			expect(stats.mode & 0o4000).toBe(0);
			// Verify SGID bit is stripped (0o2000)
			expect(stats.mode & 0o2000).toBe(0);
		});
	});
});
