import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileSink } from "../../src/fs/file-sink";

describe("createFileSink", () => {
	const testDir = "tests/fixtures/file-sink";

	beforeEach(async () => {
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("should write data to file asynchronously", async () => {
		const filePath = `${testDir}/basic.txt`;
		// Ensure parent directory exists before creating stream
		await mkdir(dirname(filePath), { recursive: true });
		const stream = createFileSink(filePath);

		// File opens on first write

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

		// File opens on first write

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

		// File opens on end() call for empty files

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

		// File opens on first write

		stream.write(Buffer.from("data1"));
		stream.write(Buffer.from("data2"));

		stream.destroy(); // Destroy the stream

		// end should be a no-op after destroy
		await stream.end(); // Should not throw

		// With ready() called, the file might be created but writes should be discarded
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

		// File opens on first write

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

	it("should handle single write efficiently", async () => {
		const filePath = `${testDir}/single.txt`;
		await mkdir(dirname(filePath), { recursive: true }); // Ensure dir exists
		const stream = createFileSink(filePath);

		// File opens on first write

		stream.write(Buffer.from("single chunk"));
		await stream.end(); // Await async end

		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("single chunk");
	});

	it("should respect file mode option", async () => {
		const filePath = `${testDir}/mode.txt`;
		await mkdir(dirname(filePath), { recursive: true }); // Ensure dir exists
		const stream = createFileSink(filePath, { mode: 0o600 });

		// File opens on first write

		stream.write(Buffer.from("test"));
		await stream.end(); // Await async end

		const stats = await stat(filePath);
		// On Unix, check the mode (Windows doesn't support this)
		if (process.platform !== "win32") {
			expect(stats.mode & 0o777).toBe(0o600);
		}
	});

	it("should skip empty writes", async () => {
		const filePath = `${testDir}/skip-empty.txt`;
		await mkdir(dirname(filePath), { recursive: true }); // Ensure dir exists
		const stream = createFileSink(filePath);

		// File opens on first write

		stream.write(Buffer.from("")); // Empty - should be skipped
		stream.write(Buffer.from("hello")); // Real data
		stream.write(Buffer.from("")); // Empty - should be skipped
		await stream.end(); // Await async end

		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("hello");
	});

	it("should handle streaming writes efficiently", async () => {
		const filePath = `${testDir}/streaming.txt`;
		await mkdir(dirname(filePath), { recursive: true });
		const stream = createFileSink(filePath);

		// File opens on first write

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

	it("should resolve waitDrain after flushing backlog", async () => {
		const filePath = `${testDir}/wait-drain.txt`;
		await mkdir(dirname(filePath), { recursive: true });
		const stream = createFileSink(filePath);

		const oversized = Buffer.alloc(300_000, 0x61); // > 256KB to trip high water mark
		expect(stream.write(oversized)).toBe(false);

		await stream.waitDrain();
		await stream.end();

		const content = await readFile(filePath, "utf-8");
		expect(content.length).toBe(oversized.length);
	});

	it("should handle mtime option with fs.futimes", async () => {
		const filePath = join(testDir, "mtime-test.txt");
		const testMtime = new Date("2023-01-15T10:30:00Z");
		const stream = createFileSink(filePath, { mtime: testMtime });

		// File opens on first write

		stream.write("test content");
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

		// File opens on first write

		// End without writing any content
		await stream.end();

		// Verify file was created and mtime was set
		const stats = await stat(filePath);
		expect(stats.mtime.getTime()).toBe(testMtime.getTime());

		// Verify file is empty
		const content = await readFile(filePath, "utf8");
		expect(content).toBe("");
	});

	it("should work without mtime option (no futimes call)", async () => {
		const filePath = join(testDir, "no-mtime-test.txt");
		const stream = createFileSink(filePath); // No mtime option

		// File opens on first write

		stream.write("content without mtime");
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

		// File opens on first write, then all writes are handled
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

		// File opens on first write - no ready() method needed

		stream.write(Buffer.from("test"));
		await stream.end();

		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("test");
	});
});
