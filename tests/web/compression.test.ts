import { describe, expect, it } from "vitest";
import { decoder, encoder, streamToBuffer } from "../../src/tar/utils";
import {
	createGzipDecoder,
	createGzipEncoder,
	createTarDecoder,
	createTarPacker,
	packTar,
	type TarEntry,
	unpackTar,
} from "../../src/web/index";

describe("compression", () => {
	describe("streaming compression", () => {
		it("single file", async () => {
			const { readable, controller } = createTarPacker();
			const compressedStream = readable.pipeThrough(createGzipEncoder());

			const fileStream = controller.add({
				name: "file.txt",
				size: 5,
				type: "file",
				mode: 0o644,
				mtime: new Date(1387580181000),
				uid: 501,
				gid: 20,
				uname: "user",
				gname: "staff",
			});
			const writer = fileStream.getWriter();
			await writer.write(encoder.encode("hello"));
			await writer.close();
			controller.finalize();

			// Verify compression works
			const compressedBuffer = await streamToBuffer(compressedStream);
			expect(compressedBuffer.byteLength).toBeGreaterThan(0);

			// Verify decompression
			const decompressedStream = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(compressedBuffer));
					controller.close();
				},
			}).pipeThrough(createGzipDecoder());

			const decompressedBuffer = await streamToBuffer(decompressedStream);
			const entries = await unpackTar(decompressedBuffer);

			expect(entries).toHaveLength(1);
			expect(entries[0].header.name).toBe("file.txt");
			expect(entries[0].header.mode).toBe(0o644);
			expect(entries[0].header.uid).toBe(501);
			expect(decoder.decode(entries[0].data)).toBe("hello");
		});

		it("handles multiple entries with streaming compression", async () => {
			const { readable, controller } = createTarPacker();
			const compressedStream = readable.pipeThrough(createGzipEncoder());

			// Add directory
			controller.add({
				name: "dir/",
				type: "directory",
				mode: 0o755,
				size: 0,
				mtime: new Date(1387580181000),
			});

			// Add files
			const file1Stream = controller.add({
				name: "dir/file1.txt",
				size: 8,
				type: "file",
				mode: 0o644,
				mtime: new Date(1387580181000),
			});
			const writer1 = file1Stream.getWriter();
			await writer1.write(encoder.encode("content1"));
			await writer1.close();

			const file2Stream = controller.add({
				name: "file2.txt",
				size: 8,
				type: "file",
				mode: 0o755,
				mtime: new Date(1387580181000),
			});
			const writer2 = file2Stream.getWriter();
			await writer2.write(encoder.encode("content2"));
			await writer2.close();

			controller.finalize();

			// Verify round-trip
			const compressedBuffer = await streamToBuffer(compressedStream);
			const decompressedStream = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(compressedBuffer));
					controller.close();
				},
			}).pipeThrough(createGzipDecoder());

			const decompressedBuffer = await streamToBuffer(decompressedStream);
			const entries = await unpackTar(decompressedBuffer);

			expect(entries).toHaveLength(3);
			expect(entries[0].header.name).toBe("dir/");
			expect(entries[0].header.type).toBe("directory");
			expect(entries[1].header.name).toBe("dir/file1.txt");
			expect(entries[2].header.name).toBe("file2.txt");
		});
	});
});

describe("decompression", () => {
	describe("buffered decompression", () => {
		it("single file", async () => {
			const originalEntries: TarEntry[] = [
				{
					header: {
						name: "extracted.txt",
						size: 12,
						type: "file",
						mode: 0o644,
						mtime: new Date(1387580181000),
						uid: 1000,
						gid: 1000,
						uname: "testuser",
						gname: "testgroup",
					},
					body: "test content",
				},
			];

			const tarBuffer = await packTar(originalEntries);
			const compressedStream = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(tarBuffer));
					controller.close();
				},
			}).pipeThrough(createGzipEncoder());

			const compressedBuffer = await streamToBuffer(compressedStream);

			// Simulate response.body from fetch
			const responseBody = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(compressedBuffer));
					controller.close();
				},
			});

			const entries = await unpackTar(
				responseBody.pipeThrough(createGzipDecoder()),
			);

			for (const entry of entries) {
				const content = decoder.decode(entry.data);
				expect(content).toBe("test content");
			}

			expect(entries).toHaveLength(1);
			expect(entries[0].header.name).toBe("extracted.txt");
			expect(entries[0].header.mode).toBe(0o644);
			expect(entries[0].header.uid).toBe(1000);
			expect(decoder.decode(entries[0].data)).toBe("test content");
		});

		it("handles multiple files with buffered decompression", async () => {
			const originalEntries: TarEntry[] = [
				{
					header: {
						name: "file1.txt",
						size: 8,
						type: "file",
						mode: 0o644,
						mtime: new Date(1387580181000),
					},
					body: "content1",
				},
				{
					header: {
						name: "file2.txt",
						size: 8,
						type: "file",
						mode: 0o644,
						mtime: new Date(1387580181000),
					},
					body: "content2",
				},
			];

			const tarBuffer = await packTar(originalEntries);
			const compressedStream = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(tarBuffer));
					controller.close();
				},
			}).pipeThrough(createGzipEncoder());

			const compressedBuffer = await streamToBuffer(compressedStream);

			const responseBody = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(compressedBuffer));
					controller.close();
				},
			});

			const entries = await unpackTar(
				responseBody.pipeThrough(createGzipDecoder()),
			);

			expect(entries).toHaveLength(2);
			expect(entries[0].header.name).toBe("file1.txt");
			expect(entries[1].header.name).toBe("file2.txt");
			expect(decoder.decode(entries[0].data)).toBe("content1");
			expect(decoder.decode(entries[1].data)).toBe("content2");
		});
	});

	describe("streaming decompression", () => {
		it("async iterable pattern", async () => {
			// Create compressed archive
			const originalEntries: TarEntry[] = [
				{
					header: {
						name: "stream1.txt",
						size: 8,
						type: "file",
						mode: 0o644,
						mtime: new Date(1387580181000),
					},
					body: "stream 1",
				},
				{
					header: {
						name: "stream2.txt",
						size: 8,
						type: "file",
						mode: 0o644,
						mtime: new Date(1387580181000),
					},
					body: "stream 2",
				},
			];

			const tarBuffer = await packTar(originalEntries);
			const compressedStream = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(tarBuffer));
					controller.close();
				},
			}).pipeThrough(createGzipEncoder());

			const compressedBuffer = await streamToBuffer(compressedStream);

			// Simulate response.body
			const responseBody = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(compressedBuffer));
					controller.close();
				},
			});

			const entries = responseBody
				.pipeThrough(createGzipDecoder())
				.pipeThrough(createTarDecoder());

			const processedEntries: Array<{ name: string; content: string }> = [];

			for await (const entry of entries) {
				// Process entry.body ReadableStream as needed
				const bodyReader = entry.body.getReader();
				const { value: bodyChunk } = await bodyReader.read();
				bodyReader.releaseLock();

				processedEntries.push({
					name: entry.header.name,
					content: decoder.decode(bodyChunk),
				});
			}

			expect(processedEntries).toHaveLength(2);
			expect(processedEntries[0].name).toBe("stream1.txt");
			expect(processedEntries[0].content).toBe("stream 1");
			expect(processedEntries[1].name).toBe("stream2.txt");
			expect(processedEntries[1].content).toBe("stream 2");
		});

		it("handles large content with streaming decompression", async () => {
			const largeContent = "x".repeat(10000);
			const originalEntries: TarEntry[] = [
				{
					header: {
						name: "large.txt",
						size: largeContent.length,
						type: "file",
						mode: 0o644,
						mtime: new Date(1387580181000),
					},
					body: largeContent,
				},
			];

			const tarBuffer = await packTar(originalEntries);
			const compressedStream = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(tarBuffer));
					controller.close();
				},
			}).pipeThrough(createGzipEncoder());

			const compressedBuffer = await streamToBuffer(compressedStream);

			const responseBody = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(compressedBuffer));
					controller.close();
				},
			});

			const entries = responseBody
				.pipeThrough(createGzipDecoder())
				.pipeThrough(createTarDecoder());

			let entryCount = 0;
			for await (const entry of entries) {
				entryCount++;
				expect(entry.header.name).toBe("large.txt");
				expect(entry.header.size).toBe(largeContent.length);

				// Verify we can read the large content
				const bodyReader = entry.body.getReader();
				const chunks: Uint8Array[] = [];
				while (true) {
					const { done, value } = await bodyReader.read();
					if (done) break;
					chunks.push(value);
				}
				bodyReader.releaseLock();

				const totalLength = chunks.reduce(
					(sum, chunk) => sum + chunk.length,
					0,
				);
				const fullContent = new Uint8Array(totalLength);
				let offset = 0;
				for (const chunk of chunks) {
					fullContent.set(chunk, offset);
					offset += chunk.length;
				}

				expect(decoder.decode(fullContent)).toBe(largeContent);
			}

			expect(entryCount).toBe(1);
		});

		it("streams compressed archives with proper decompression", async () => {
			const originalEntries: TarEntry[] = [
				{
					header: {
						name: "stream-file1.txt",
						size: 12,
						type: "file",
						mode: 0o644,
						mtime: new Date(1387580181000),
					},
					body: "stream test1",
				},
				{
					header: {
						name: "stream-file2.txt",
						size: 12,
						type: "file",
						mode: 0o644,
						mtime: new Date(1387580181000),
					},
					body: "stream test2",
				},
			];

			const tarBuffer = await packTar(originalEntries);
			const compressedStream = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(tarBuffer));
					controller.close();
				},
			}).pipeThrough(createGzipEncoder());

			const compressedBuffer = await streamToBuffer(compressedStream);

			// Stream the compressed archive through decoder
			const responseBody = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(compressedBuffer));
					controller.close();
				},
			});

			const entries = responseBody
				.pipeThrough(createGzipDecoder())
				.pipeThrough(createTarDecoder());

			let entryCount = 0;
			for await (const entry of entries) {
				entryCount++;

				expect(entry.header.name).toBe(`stream-file${entryCount}.txt`);
				expect(entry.header.type).toBe("file");
				expect(entry.header.size).toBe(12);

				const bodyReader = entry.body.getReader();
				const { value: bodyChunk } = await bodyReader.read();
				bodyReader.releaseLock();

				expect(decoder.decode(bodyChunk)).toBe(`stream test${entryCount}`);
			}

			expect(entryCount).toBe(2);
		});
	});

	describe("error handling", () => {
		it("handles invalid gzip data gracefully", async () => {
			const invalidGzipData = new Uint8Array([
				0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff, 0xff, 0xff,
			]);

			const decompressedStream = new ReadableStream({
				start(controller) {
					controller.enqueue(invalidGzipData);
					controller.close();
				},
			}).pipeThrough(createGzipDecoder());

			await expect(streamToBuffer(decompressedStream)).rejects.toThrow();
		});

		it("handles premature stream termination during compression", async () => {
			const { readable, controller } = createTarPacker();
			const compressedStream = readable.pipeThrough(createGzipEncoder());

			// Add partial entry and expect error
			const fileStream = controller.add({
				name: "incomplete.txt",
				size: 100, // Claim 100 bytes but don't write them all
				type: "file",
				mode: 0o644,
			});

			const writer = fileStream.getWriter();
			await writer.write(encoder.encode("partial")); // Only 7 bytes

			// This should throw due to size mismatch
			await expect(writer.close()).rejects.toThrow(
				/Size mismatch for "incomplete\.txt"\./,
			);

			// Verify the compressed stream also fails
			await expect(streamToBuffer(compressedStream)).rejects.toThrow();
		});

		it("handles oversized content during compression", async () => {
			const { readable, controller } = createTarPacker();
			const compressedStream = readable.pipeThrough(createGzipEncoder());

			// Add entry with content larger than declared size
			const fileStream = controller.add({
				name: "oversized.txt",
				size: 5, // Claim only 5 bytes
				type: "file",
				mode: 0o644,
			});

			const writer = fileStream.getWriter();

			// This should throw when we try to write more than the declared size
			await writer.write(encoder.encode("hello")); // 5 bytes - OK
			await expect(
				writer.write(encoder.encode(" world")), // 6 more bytes - should fail
			).rejects.toThrow(/"oversized\.txt" exceeds given size of/);

			// Stream should also fail
			await expect(streamToBuffer(compressedStream)).rejects.toThrow();
		});
	});
});
