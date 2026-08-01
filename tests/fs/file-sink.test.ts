import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileSink } from "../../src/fs/file-sink";

let nextWriteError: Error | null = null;
let nextPartialWrite: number | null = null;
let nextFutimesError: Error | null = null;
let failedFutimesFd: number | null = null;
let closedFds: number[] = [];
let delayExistingOpen = false;
let releaseExistingOpen: (() => void) | null = null;
let delayRemove = false;
let releaseRemove: (() => void) | null = null;
let openCalls = 0;
let removeCalls = 0;

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	const write = (...args: unknown[]) => {
		const error = nextWriteError;
		const callback = args.at(-1) as (
			error: Error | null,
			written: number,
		) => void;
		if (error) {
			nextWriteError = null;
			queueMicrotask(() => callback(error, 0));
			return;
		}
		if (nextPartialWrite === null)
			return Reflect.apply(actual.write, actual, args);
		const written = Math.min(nextPartialWrite, args[3] as number);
		nextPartialWrite = null;
		if (written === 0) {
			queueMicrotask(() => callback(null, 0));
			return;
		}
		return actual.write(
			args[0] as number,
			args[1] as Buffer,
			args[2] as number,
			written,
			args[4] as number | null,
			callback,
		);
	};
	const writev = (...args: unknown[]) => {
		if (nextPartialWrite === null)
			return Reflect.apply(actual.writev, actual, args);
		const callback = args.at(-1) as (
			error: Error | null,
			written: number,
		) => void;
		let remaining = nextPartialWrite;
		nextPartialWrite = null;
		if (remaining === 0) {
			queueMicrotask(() => callback(null, 0));
			return;
		}
		const buffers: Uint8Array[] = [];
		for (const buffer of args[1] as Uint8Array[]) {
			if (remaining === 0) break;
			buffers.push(buffer.subarray(0, remaining));
			remaining -= Math.min(remaining, buffer.length);
		}
		return actual.writev(args[0] as number, buffers, callback);
	};
	return {
		...actual,
		close: ((...args: unknown[]) => {
			closedFds.push(args[0] as number);
			return Reflect.apply(actual.close, actual, args);
		}) as typeof actual.close,
		futimes: ((...args: unknown[]) => {
			const error = nextFutimesError;
			if (!error) return Reflect.apply(actual.futimes, actual, args);
			nextFutimesError = null;
			failedFutimesFd = args[0] as number;
			const callback = args.at(-1) as (error: Error) => void;
			queueMicrotask(() => callback(error));
		}) as typeof actual.futimes,
		open: ((...args: unknown[]) => {
			openCalls++;
			const callback = args.at(-1) as (
				error: NodeJS.ErrnoException | null,
				fd: number,
			) => void;
			const onOpen = (error: NodeJS.ErrnoException | null, fd: number) => {
				if (delayExistingOpen && error?.code === "EEXIST") {
					delayExistingOpen = false;
					releaseExistingOpen = () => callback(error, fd);
					return;
				}
				callback(error, fd);
			};
			return Reflect.apply(actual.open, actual, [...args.slice(0, -1), onOpen]);
		}) as typeof actual.open,
		rm: ((...args: unknown[]) => {
			removeCalls++;
			if (delayRemove) {
				delayRemove = false;
				const callback = args.at(-1) as (error: Error | null) => void;
				return Reflect.apply(actual.rm, actual, [
					...args.slice(0, -1),
					(error: Error | null) => {
						releaseRemove = () => callback(error);
					},
				]);
			}
			return Reflect.apply(actual.rm, actual, args);
		}) as typeof actual.rm,
		write: write as typeof actual.write,
		writev: writev as typeof actual.writev,
	};
});

describe("createFileSink", () => {
	const testDir = "tests/fixtures/file-sink";

	beforeEach(async () => {
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		nextWriteError = null;
		nextPartialWrite = null;
		nextFutimesError = null;
		failedFutimesFd = null;
		closedFds = [];
		releaseExistingOpen?.();
		releaseExistingOpen = null;
		delayExistingOpen = false;
		releaseRemove?.();
		releaseRemove = null;
		delayRemove = false;
		openCalls = 0;
		removeCalls = 0;
		await rm(testDir, { recursive: true, force: true });
	});

	it("should write data to file asynchronously", async () => {
		const filePath = `${testDir}/basic.txt`;
		// Ensure parent directory exists before creating stream
		await mkdir(dirname(filePath), { recursive: true });
		const stream = createFileSink(filePath);

		stream.write(Buffer.from("hello"));
		stream.write(Buffer.from(" world"));
		// Await the asynchronous end
		await stream.end();

		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("hello world");
	});

	it("should handle multiple writes and batch with fs.writev", async () => {
		const filePath = `${testDir}/batched.txt`;
		await mkdir(dirname(filePath), { recursive: true }); // Ensure dir exists
		const stream = createFileSink(filePath);

		// Buffer multiple writes
		stream.write(Buffer.from("chunk1\n"));
		stream.write(Buffer.from("chunk2\n"));
		stream.write(Buffer.from("chunk3\n"));

		// End once - should use writev for multiple buffers
		await stream.end();

		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("chunk1\nchunk2\nchunk3\n");
	});

	it("should handle empty file (no writes)", async () => {
		const filePath = `${testDir}/empty.txt`;
		await mkdir(dirname(filePath), { recursive: true }); // Ensure dir exists
		const stream = createFileSink(filePath);

		// No writes, just end
		await stream.end(); // Await async end

		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("");
		// Ensure file exists
		await expect(stat(filePath)).resolves.toBeDefined();
	});

	it("should handle destroy gracefully with immediate file opening", async () => {
		const filePath = `${testDir}/destroyed.txt`;
		await mkdir(dirname(filePath), { recursive: true });
		const stream = createFileSink(filePath);

		stream.write(Buffer.from("data1"));
		stream.write(Buffer.from("data2"));

		stream.destroy(); // Destroy the stream

		// end should be a no-op after destroy
		await stream.end(); // Should not throw

		// The file might be created, but writes should be discarded.
		try {
			const content = await readFile(filePath, "utf-8");
			// File exists but should be empty since writes were discarded
			expect(content).toBe("");
		} catch (err) {
			// File might not exist if destroy happened very early
			expect((err as NodeJS.ErrnoException).code).toBe("ENOENT");
		}
	});

	it("should discard queued writes after destroy", async () => {
		const filePath = `${testDir}/discarded-queue.txt`;
		await mkdir(dirname(filePath), { recursive: true });
		const stream = createFileSink(filePath);

		// Write some data
		stream.write(Buffer.from("written"));

		// Destroy immediately before queued writes can be processed
		stream.destroy();

		// These writes should be ignored
		stream.write(Buffer.from("ignored1"));
		stream.write(Buffer.from("ignored2"));

		await stream.end(); // Should not throw

		// File may exist with initial data or be empty, depending on timing
		try {
			const content = await readFile(filePath, "utf-8");
			// Should only contain data written before destroy
			expect(content).not.toContain("ignored");
		} catch (err) {
			// File might not exist if destroy happened before any writes were flushed
			expect((err as NodeJS.ErrnoException).code).toBe("ENOENT");
		}
	});

	it("should ignore write after destroy", () => {
		const filePath = `${testDir}/write-after-destroy.txt`;
		const stream = createFileSink(filePath);

		stream.destroy();

		// Should not throw, just silently discard
		expect(() => {
			stream.write(Buffer.from("data"));
		}).not.toThrow();
	});

	it("should not replace an existing file after cancellation", async () => {
		const filePath = `${testDir}/existing.txt`;
		await writeFile(filePath, "original");
		delayExistingOpen = true;
		const stream = createFileSink(filePath);
		await vi.waitFor(() => expect(releaseExistingOpen).toBeTypeOf("function"));

		const cancelError = new Error("cancelled");
		stream.destroy(cancelError);
		releaseExistingOpen?.();
		releaseExistingOpen = null;
		await new Promise<void>((resolve) => setImmediate(resolve));

		await expect(stream.end()).rejects.toBe(cancelError);
		expect(removeCalls).toBe(0);
		expect(await readFile(filePath, "utf8")).toBe("original");
	});

	it("should not reopen a removed file after cancellation", async () => {
		const filePath = `${testDir}/removed.txt`;
		await writeFile(filePath, "original");
		delayRemove = true;
		const stream = createFileSink(filePath);
		await vi.waitFor(() => expect(releaseRemove).toBeTypeOf("function"));

		const cancelError = new Error("cancelled");
		stream.destroy(cancelError);
		releaseRemove?.();
		releaseRemove = null;
		await new Promise<void>((resolve) => setImmediate(resolve));

		await expect(stream.end()).rejects.toBe(cancelError);
		expect(openCalls).toBe(1);
		expect(removeCalls).toBe(1);
		await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("should handle single write efficiently", async () => {
		const filePath = `${testDir}/single.txt`;
		await mkdir(dirname(filePath), { recursive: true }); // Ensure dir exists
		const stream = createFileSink(filePath);

		stream.write(Buffer.from("single chunk"));
		await stream.end(); // Await async end

		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("single chunk");
	});

	it("should respect file mode option", async () => {
		const filePath = `${testDir}/mode.txt`;
		await mkdir(dirname(filePath), { recursive: true }); // Ensure dir exists
		const stream = createFileSink(filePath, { mode: 0o600 });

		stream.write(Buffer.from("test"));
		await stream.end(); // Await async end

		const stats = await stat(filePath);
		// On Unix, check the mode (Windows doesn't support this)
		if (process.platform !== "win32") {
			expect(stats.mode & 0o777).toBe(0o600);
		}
	});

	it("should handle streaming writes efficiently", async () => {
		const filePath = `${testDir}/streaming.txt`;
		await mkdir(dirname(filePath), { recursive: true });
		const stream = createFileSink(filePath);

		stream.write(Buffer.from("test data"));

		// Measure end time - should handle async operations efficiently
		const start = performance.now();
		await stream.end();
		const elapsed = performance.now() - start;

		// Verify file was written correctly
		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("test data");

		// Flush should be fast since it doesn't wait for close
		// This is more of a behavioral test than a strict timing test
		expect(elapsed).toBeLessThan(100); // Should be well under 100ms
	});

	it("should resolve waitDrain after partially flushing backlog", async () => {
		const filePath = `${testDir}/wait-drain.txt`;
		await mkdir(dirname(filePath), { recursive: true });
		const stream = createFileSink(filePath);

		const oversized = Buffer.alloc(8 * 1024 * 1024 + 1, 0x61);
		nextPartialWrite = 1024;
		expect(stream.write(oversized)).toBe(false);

		await stream.waitDrain();
		await stream.end();

		const content = await readFile(filePath, "utf-8");
		expect(content.length).toBe(oversized.length);
	});

	it("should preserve an asynchronous write error", async () => {
		const filePath = `${testDir}/write-error.txt`;
		const stream = createFileSink(filePath);
		await stream.waitDrain();

		const writeError = new Error("disk write failed");
		nextWriteError = writeError;
		stream.write(Buffer.alloc(256 * 1024));
		await Promise.resolve();

		await expect(stream.waitDrain()).rejects.toBe(writeError);
		await expect(stream.end()).rejects.toBe(writeError);
	});

	it("should retry the unwritten suffix of a partial write", async () => {
		const filePath = `${testDir}/partial-write.txt`;
		const stream = createFileSink(filePath);
		await stream.waitDrain();

		nextPartialWrite = 5;
		stream.write(Buffer.from("hello world"));
		await stream.end();

		expect(await readFile(filePath, "utf8")).toBe("hello world");
	});

	it("should retry the unwritten suffix of a partial writev", async () => {
		const filePath = `${testDir}/partial-writev.txt`;
		const stream = createFileSink(filePath);
		await stream.waitDrain();

		nextPartialWrite = 7;
		stream.write(Buffer.from("hello"));
		stream.write(Buffer.from(" world"));
		stream.write(Buffer.from("!"));
		await stream.end();

		expect(await readFile(filePath, "utf8")).toBe("hello world!");
	});

	it("should reject a write that makes no progress", async () => {
		const filePath = `${testDir}/zero-write.txt`;
		const stream = createFileSink(filePath);
		await stream.waitDrain();

		nextPartialWrite = 0;
		stream.write(Buffer.alloc(256 * 1024));

		await expect(stream.end()).rejects.toThrow("made no progress");
	});

	it("should handle mtime option with fs.futimes", async () => {
		const filePath = join(testDir, "mtime-test.txt");
		const testMtime = new Date("2023-01-15T10:30:00Z");
		const stream = createFileSink(filePath, { mtime: testMtime });

		stream.write(Buffer.from("test content"));
		await stream.end();

		// Verify file was created and mtime was set
		const stats = await stat(filePath);
		expect(stats.mtime.getTime()).toBe(testMtime.getTime());

		// Verify content
		const content = await readFile(filePath, "utf8");
		expect(content).toBe("test content");
	});

	it("should handle mtime option with empty file", async () => {
		const filePath = join(testDir, "empty-mtime-test.txt");
		const testMtime = new Date("2023-06-20T15:45:30Z");
		const stream = createFileSink(filePath, { mtime: testMtime });

		// End without writing any content
		await stream.end();

		// Verify file was created and mtime was set
		const stats = await stat(filePath);
		expect(stats.mtime.getTime()).toBe(testMtime.getTime());

		// Verify file is empty
		const content = await readFile(filePath, "utf8");
		expect(content).toBe("");
	});

	it("should close the file descriptor when futimes fails", async () => {
		const filePath = join(testDir, "mtime-error.txt");
		const stream = createFileSink(filePath, { mtime: new Date() });
		await stream.waitDrain();
		const futimesError = new Error("futimes failed");
		nextFutimesError = futimesError;

		await expect(stream.end()).rejects.toBe(futimesError);
		expect(closedFds).toContain(failedFutimesFd);
	});

	it("should work without mtime option (no futimes call)", async () => {
		const filePath = join(testDir, "no-mtime-test.txt");
		const stream = createFileSink(filePath); // No mtime option

		stream.write(Buffer.from("content without mtime"));
		await stream.end();

		// Verify file was created
		const stats = await stat(filePath);
		expect(stats.isFile()).toBe(true);

		// Verify content
		const content = await readFile(filePath, "utf8");
		expect(content).toBe("content without mtime");
	});

	it("should handle writes immediately as file opens", async () => {
		const filePath = `${testDir}/immediate-writes.txt`;
		await mkdir(dirname(filePath), { recursive: true });
		const stream = createFileSink(filePath);

		stream.write(Buffer.from("data1"));
		stream.write(Buffer.from("data2"));
		stream.write(Buffer.from("data3"));

		await stream.end();

		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("data1data2data3");
	});

	it("should handle normal operation without ready() method", async () => {
		const filePath = `${testDir}/no-ready-needed.txt`;
		await mkdir(dirname(filePath), { recursive: true });
		const stream = createFileSink(filePath);

		stream.write(Buffer.from("test"));
		await stream.end();

		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("test");
	});
});
