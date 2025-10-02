import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packTar, unpackTar } from "../../src/fs/index.js";

describe("stream coordination cases", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vitest-unpack-tar-"));
	});

	afterEach(async () => {
		await fsp.rm(tmpDir, { recursive: true, force: true });
	});

	const createTestArchive = async (
		archivePath: string,
		files: { name: string; content: string }[],
	) => {
		const sourceDir = path.join(path.dirname(archivePath), "source");
		await fsp.mkdir(sourceDir, { recursive: true });

		for (const file of files) {
			const filePath = path.join(sourceDir, file.name);
			await fsp.mkdir(path.dirname(filePath), { recursive: true });
			await fsp.writeFile(filePath, file.content);
		}

		await pipeline(
			packTar(sourceDir),
			createGzip(),
			fs.createWriteStream(archivePath),
		);
	};

	const assertNoRaceConditionError = (error: unknown) => {
		if (error instanceof Error) {
			expect(error.message).not.toContain(
				"TransformStream has been terminated",
			);
			expect(error.message).not.toContain("WritableStream is closed");
		}
	};

	describe("creation and destruction", () => {
		it("should handle immediate destruction without race condition errors", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fsp.mkdir(extractDir);
			const unpackStream = unpackTar(extractDir);
			const errors: Error[] = [];

			unpackStream.on("error", (err) => errors.push(err));
			unpackStream.destroy(new Error("Immediate destruction"));

			await new Promise((resolve) => unpackStream.on("close", resolve));

			errors.forEach(assertNoRaceConditionError);
		});

		it.each([
			["immediate end()", (stream: Writable) => stream.end()],
			[
				"empty buffer write then end()",
				(stream: Writable) => {
					stream.write(Buffer.alloc(0));
					stream.end();
				},
			],
			[
				"end() followed by immediate destroy()",
				(stream: Writable) => {
					stream.end();
					stream.destroy();
				},
			],
			[
				"write then destroy()",
				(stream: Writable) => {
					stream.write(Buffer.from("some data"));
					stream.destroy();
				},
			],
		])("should complete quickly on %s", async (_, action) => {
			const extractDir = path.join(tmpDir, "extract");
			await fsp.mkdir(extractDir);
			const unpackStream = unpackTar(extractDir);
			unpackStream.on("error", () => {}); // Suppress expected errors

			const startTime = Date.now();
			action(unpackStream);

			await new Promise((resolve) => unpackStream.on("close", resolve));
			expect(Date.now() - startTime).toBeLessThan(1000);
		});

		it("should handle multiple rapid end() calls gracefully", async () => {
			const extractDir = path.join(tmpDir, "extract");
			await fsp.mkdir(extractDir);
			const unpackStream = unpackTar(extractDir);
			unpackStream.on("error", () => {}); // Suppress expected errors

			unpackStream.end();
			expect(() => unpackStream.end()).not.toThrow();
			expect(() => unpackStream.end()).not.toThrow();

			await new Promise((resolve) => unpackStream.on("close", resolve));
		});

		it("handles ReadableStream cancel with non Error reason", async () => {
			const destDir = path.join(tmpDir, "extracted");
			const unpackStream = unpackTar(destDir);

			unpackStream.on("error", () => {
				// Expected error, do nothing
			});

			// Write some data and then destroy with a string reason
			unpackStream.write(Buffer.from("test data"));

			// Web Streams can be cancelled with any type, including strings
			unpackStream.destroy("test cancel reason" as unknown as Error);

			// The destroy should complete without throwing
			await new Promise((resolve) => {
				unpackStream.on("close", resolve);
			});
		});

		it("handles immediate stream destruction gracefully", async () => {
			const destDir = path.join(tmpDir, "extracted");
			const unpackStream = unpackTar(destDir);

			// Write some data and immediately destroy
			const testData = Buffer.from("test data");
			unpackStream.write(testData);

			const errors: Error[] = [];
			unpackStream.on("error", (err: Error) => {
				errors.push(err);
			});

			unpackStream.destroy(new Error("Immediate destruction test"));

			// Wait for destruction to complete
			await new Promise((resolve) => {
				unpackStream.on("close", resolve);
			});

			// Should not throw TransformStream termination error
			for (const error of errors) {
				expect(error.message).not.toContain(
					"Invalid state: TransformStream has been terminated",
				);
			}
		});

		it("prevents TransformStream race condition during concurrent write/processing", async () => {
			const destDir = path.join(tmpDir, "extracted");

			// Test the specific race condition scenario where writes happen
			// while processing completes
			for (let i = 0; i < 5; i++) {
				const unpackStream = unpackTar(destDir);
				const errors: Error[] = [];

				unpackStream.on("error", (err: Error) => {
					errors.push(err);
				});

				unpackStream.write(Buffer.alloc(100, 65)); // Fill with 'A'

				const completionPromise = new Promise((resolve) => {
					unpackStream.on("close", resolve);
					unpackStream.on("error", resolve);
				});

				// Quickly destroy the stream to trigger race condition
				unpackStream.destroy(new Error(`Race test ${i}`));

				await completionPromise;

				for (const error of errors) {
					expect(error.message).not.toContain(
						"Invalid state: TransformStream has been terminated",
					);
				}
			}
		});

		it("handles write operations after processing completion", async () => {
			const destDir = path.join(tmpDir, "extracted");
			const unpackStream = unpackTar(destDir);

			const errors: Error[] = [];
			unpackStream.on("error", (err: Error) => {
				errors.push(err);
			});

			// End the stream immediately to trigger quick completion
			unpackStream.end();

			// Wait for completion
			await new Promise((resolve) => {
				unpackStream.on("close", resolve);
			});

			// Verify no TransformStream termination errors
			for (const error of errors) {
				expect(error.message).not.toContain(
					"Invalid state: TransformStream has been terminated",
				);
			}
		});
	});

	describe("pipeline stress tests", () => {
		it("should handle various destruction patterns during pipeline processing", async () => {
			const tarPath = path.join(tmpDir, "test.tar.gz");
			await createTestArchive(tarPath, [{ name: "test.txt", content: "data" }]);

			let raceConditionDetected = false;
			const detectRaceError = (err: Error) => {
				if (
					err.message.includes("TransformStream has been terminated") ||
					err.message.includes("WritableStream is closed")
				) {
					raceConditionDetected = true;
				}
			};

			for (let i = 0; i < 5; i++) {
				const extractDir = path.join(tmpDir, `extract-${i}`);
				await fsp.mkdir(extractDir);
				const readStream = fs.createReadStream(tarPath);
				const gunzipStream = createGunzip();
				const unpackStream = unpackTar(extractDir);

				readStream.on("error", detectRaceError);
				gunzipStream.on("error", detectRaceError);
				unpackStream.on("error", detectRaceError);

				const pipelinePromise = pipeline(
					readStream,
					gunzipStream,
					unpackStream,
				).catch(detectRaceError);

				// Destroy different streams in the pipeline to test robustness
				if (i % 2 === 0) {
					unpackStream.destroy(new Error(`Test destroy ${i}`));
				} else {
					gunzipStream.destroy(new Error(`Test destroy ${i}`));
				}

				await pipelinePromise;
			}

			expect(raceConditionDetected).toBe(false);
		});

		it("should handle pipelines with empty archives gracefully", async () => {
			const tarPath = path.join(tmpDir, "empty.tar.gz");
			await createTestArchive(tarPath, []);
			const extractDir = path.join(tmpDir, "extract-empty");
			await fsp.mkdir(extractDir);

			const readStream = fs.createReadStream(tarPath);
			const gunzipStream = createGunzip();
			const unpackStream = unpackTar(extractDir);

			await pipeline(readStream, gunzipStream, unpackStream).catch((err) => {
				assertNoRaceConditionError(err);
			});
		});

		it("should handle many concurrent pipelines without race conditions", async () => {
			const tarPath = path.join(tmpDir, "concurrent.tar.gz");
			await createTestArchive(tarPath, [{ name: "test.txt", content: "data" }]);
			let raceConditionDetected = false;

			const promises = Array.from({ length: 10 }).map(async (_, i) => {
				const extractDir = path.join(tmpDir, `extract-concurrent-${i}`);
				await fsp.mkdir(extractDir);

				const readStream = fs.createReadStream(tarPath);
				const gunzipStream = createGunzip();
				const unpackStream = unpackTar(extractDir);

				const detectRaceError = (err: Error) => {
					if (
						err.message.includes("TransformStream has been terminated") ||
						err.message.includes("WritableStream is closed")
					) {
						raceConditionDetected = true;
					}
				};

				// Handle all possible error sources to prevent unhandled rejections
				readStream.on("error", () => {}); // Suppress expected errors
				gunzipStream.on("error", () => {}); // Suppress expected zlib errors
				unpackStream.on("error", detectRaceError);

				const pipelinePromise = pipeline(
					readStream,
					gunzipStream,
					unpackStream,
				).catch(() => {
					// Suppress pipeline errors to prevent unhandled rejections
				});

				// Apply immediate destruction patterns (no setTimeout to avoid unhandled errors)
				if (i % 4 === 1) {
					try {
						unpackStream.destroy();
					} catch {
						// Suppress destruction errors
					}
				} else if (i % 4 === 2) {
					// Skip gunzip destruction to avoid premature close errors
					try {
						unpackStream.destroy();
					} catch {
						// Suppress destruction errors
					}
				} else if (i % 4 === 3) {
					try {
						unpackStream.destroy();
					} catch {
						// Suppress destruction errors
					}
				}
				// The i % 4 === 0 case is allowed to complete

				try {
					await pipelinePromise;
				} catch (err) {
					// Final catch to prevent any unhandled rejections
					if (err instanceof Error) {
						detectRaceError(err);
					}
				}
			});

			await Promise.allSettled(promises);
			expect(raceConditionDetected).toBe(false);
		});
	});
});
