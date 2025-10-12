import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packTar, type TarSource, unpackTar } from "../../src/fs";
import { encoder } from "../../src/tar/utils";

const isWindows = process.platform === "win32";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

let expectedHelloContent: string;
let expectedTestContent: string;

describe("packTarSources", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "modern-tar-archive-test-"),
		);

		// Read the actual fixture files to handle line endings correctly
		expectedHelloContent = await fs.readFile(
			path.join(FIXTURES_DIR, "a", "hello.txt"),
			"utf-8",
		);
		expectedTestContent = await fs.readFile(
			path.join(FIXTURES_DIR, "b", "a", "test.txt"),
			"utf-8",
		);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("packs a single file source", async () => {
		const sources: TarSource[] = [
			{
				type: "file",
				source: path.join(FIXTURES_DIR, "a", "hello.txt"),
				target: "output/hello.txt",
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "test.tar");
		const destDir = path.join(tmpDir, "extracted");

		// Write tar to file and extract
		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify extraction
		const extractedFile = path.join(destDir, "output", "hello.txt");
		const content = await fs.readFile(extractedFile, "utf-8");
		expect(content).toBe(expectedHelloContent);

		// Verify file stats are preserved
		const originalStat = await fs.stat(
			path.join(FIXTURES_DIR, "a", "hello.txt"),
		);
		const extractedStat = await fs.stat(extractedFile);
		expect(extractedStat.mode).toBe(originalStat.mode);
	});

	it("packs multiple file sources", async () => {
		const sources: TarSource[] = [
			{
				type: "file",
				source: path.join(FIXTURES_DIR, "a", "hello.txt"),
				target: "files/hello.txt",
			},
			{
				type: "file",
				source: path.join(FIXTURES_DIR, "b", "a", "test.txt"),
				target: "files/test.txt",
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "test.tar");
		const destDir = path.join(tmpDir, "extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify both files extracted
		const helloContent = await fs.readFile(
			path.join(destDir, "files", "hello.txt"),
			"utf-8",
		);
		const testContent = await fs.readFile(
			path.join(destDir, "files", "test.txt"),
			"utf-8",
		);

		expect(helloContent).toBe(expectedHelloContent);
		expect(testContent).toBe(expectedTestContent);
	});

	it("packs content sources", async () => {
		const sources: TarSource[] = [
			{
				type: "content",
				content: "Hello from string!",
				target: "text/greeting.txt",
			},
			{
				type: "content",
				content: Buffer.from("Hello from buffer!", "utf-8"),
				target: "text/buffer.txt",
			},
			{
				type: "content",
				content: new Uint8Array(Buffer.from("Hello from Uint8Array!")),
				target: "text/uint8.txt",
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "test.tar");
		const destDir = path.join(tmpDir, "extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify all content files
		const greetingContent = await fs.readFile(
			path.join(destDir, "text", "greeting.txt"),
			"utf-8",
		);
		const bufferContent = await fs.readFile(
			path.join(destDir, "text", "buffer.txt"),
			"utf-8",
		);
		const uint8Content = await fs.readFile(
			path.join(destDir, "text", "uint8.txt"),
			"utf-8",
		);

		expect(greetingContent).toBe("Hello from string!");
		expect(bufferContent).toBe("Hello from buffer!");
		expect(uint8Content).toBe("Hello from Uint8Array!");
	});

	it("packs content sources with new TarEntryData types", async () => {
		// Create test data for various types
		const testString = "Hello from ArrayBuffer!";
		const arrayBuffer = new ArrayBuffer(testString.length);
		const view = new Uint8Array(arrayBuffer);
		for (let i = 0; i < testString.length; i++) {
			view[i] = testString.charCodeAt(i);
		}

		const blobContent = "Hello from Blob!";
		const blob = new Blob([blobContent], { type: "text/plain" });

		const streamContent = "Hello from ReadableStream!";
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(streamContent));
				controller.close();
			},
		});

		const sources: TarSource[] = [
			{
				type: "content",
				content: arrayBuffer,
				target: "types/arrayBuffer.txt",
			},
			{
				type: "content",
				content: blob,
				target: "types/blob.txt",
			},
			{
				type: "stream",
				content: stream,
				target: "types/stream.txt",
				size: Buffer.byteLength(streamContent, "utf-8"),
			},
			{
				type: "content",
				content: null,
				target: "types/empty.txt",
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "test.tar");
		const destDir = path.join(tmpDir, "extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify all content files
		const arrayBufferContent = await fs.readFile(
			path.join(destDir, "types", "arrayBuffer.txt"),
			"utf-8",
		);
		const blobExtracted = await fs.readFile(
			path.join(destDir, "types", "blob.txt"),
			"utf-8",
		);
		const streamExtracted = await fs.readFile(
			path.join(destDir, "types", "stream.txt"),
			"utf-8",
		);
		const emptyContent = await fs.readFile(
			path.join(destDir, "types", "empty.txt"),
			"utf-8",
		);

		expect(arrayBufferContent).toBe("Hello from ArrayBuffer!");
		expect(blobExtracted).toBe("Hello from Blob!");
		expect(streamExtracted).toBe("Hello from ReadableStream!");
		expect(emptyContent).toBe("");
	});

	it("packs StreamSource with Node Readable", async () => {
		const readableContent = "Hello from Readable!";
		const readable = Readable.from([Buffer.from(readableContent, "utf-8")]);

		const sources: TarSource[] = [
			{
				type: "stream",
				content: readable,
				target: "streams/readable.txt",
				size: Buffer.byteLength(readableContent, "utf-8"),
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "readable-test.tar");
		const destDir = path.join(tmpDir, "readable-extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		const extractedContent = await fs.readFile(
			path.join(destDir, "streams", "readable.txt"),
			"utf-8",
		);

		expect(extractedContent).toBe("Hello from Readable!");
	});

	it("packs content sources with Node Readable streams of different chunk types", async () => {
		// Test with string chunks
		const stringChunks = Readable.from([
			"Hello ",
			"from ",
			"string ",
			"chunks!",
		]);

		// Test with mixed Buffer and Uint8Array chunks
		const mixedChunks = new Readable({
			read() {},
		});
		mixedChunks.push(Buffer.from("Mixed: "));
		mixedChunks.push(new Uint8Array([66, 117, 102, 102, 101, 114])); // "Buffer"
		mixedChunks.push(" and ");
		mixedChunks.push(new Uint8Array([85, 105, 110, 116, 56])); // "Uint8"
		mixedChunks.push(null); // End stream

		const sources: TarSource[] = [
			{
				type: "stream",
				content: stringChunks,
				target: "streams/string-chunks.txt",
				size: Buffer.byteLength("Hello from string chunks!", "utf-8"),
			},
			{
				type: "stream",
				content: mixedChunks,
				target: "streams/mixed-chunks.txt",
				size: Buffer.byteLength("Mixed: Buffer and Uint8", "utf-8"),
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "chunks-test.tar");
		const destDir = path.join(tmpDir, "chunks-extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify the content from different chunk types
		const stringContent = await fs.readFile(
			path.join(destDir, "streams", "string-chunks.txt"),
			"utf-8",
		);
		const mixedContent = await fs.readFile(
			path.join(destDir, "streams", "mixed-chunks.txt"),
			"utf-8",
		);

		expect(stringContent).toBe("Hello from string chunks!");
		expect(mixedContent).toBe("Mixed: Buffer and Uint8");
	});

	it("packs StreamSource with Web ReadableStream", async () => {
		const webStreamContent = "Hello from Web ReadableStream!";
		const webStream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(webStreamContent));
				controller.close();
			},
		});

		const sources: TarSource[] = [
			{
				type: "stream",
				content: webStream,
				target: "streams/web-stream.txt",
				size: Buffer.byteLength(webStreamContent, "utf-8"),
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "web-stream-test.tar");
		const destDir = path.join(tmpDir, "web-stream-extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		const extractedContent = await fs.readFile(
			path.join(destDir, "streams", "web-stream.txt"),
			"utf-8",
		);

		expect(extractedContent).toBe("Hello from Web ReadableStream!");
	});

	it("packs content source with custom mode", async () => {
		const sources: TarSource[] = [
			{
				type: "content",
				content: "#!/bin/bash\necho 'executable script'",
				target: "bin/script.sh",
				mode: 0o755, // Executable permissions
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "test.tar");
		const destDir = path.join(tmpDir, "extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify file mode
		const extractedStat = await fs.stat(path.join(destDir, "bin", "script.sh"));
		// File modes work differently on Windows
		if (isWindows) {
			// On Windows, executable permissions are handled differently
			expect(extractedStat.mode & 0o777).toBe(0o666);
		} else {
			expect(extractedStat.mode & 0o777).toBe(0o755);
		}
	});

	it("packs directory sources", async () => {
		const sources: TarSource[] = [
			{
				type: "directory",
				source: path.join(FIXTURES_DIR, "b"),
				target: "project/src",
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "test.tar");
		const destDir = path.join(tmpDir, "extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify directory structure
		const extractedFile = path.join(destDir, "project", "src", "a", "test.txt");
		expect(
			await fs.access(extractedFile).then(
				() => true,
				() => false,
			),
		).toBe(true);

		const content = await fs.readFile(extractedFile, "utf-8");
		expect(content).toBe(expectedTestContent);
	});

	it("packs mixed source types", async () => {
		const sources: TarSource[] = [
			{
				type: "file",
				source: path.join(FIXTURES_DIR, "a", "hello.txt"),
				target: "project/readme.txt",
			},
			{
				type: "content",
				content: '{"name": "test-project", "version": "1.0.0"}',
				target: "project/package.json",
			},
			{
				type: "directory",
				source: path.join(FIXTURES_DIR, "b"),
				target: "project/source",
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "test.tar");
		const destDir = path.join(tmpDir, "extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify all sources were packed
		const readmeContent = await fs.readFile(
			path.join(destDir, "project", "readme.txt"),
			"utf-8",
		);
		const packageContent = await fs.readFile(
			path.join(destDir, "project", "package.json"),
			"utf-8",
		);
		const sourceFile = path.join(destDir, "project", "source", "a", "test.txt");

		expect(readmeContent).toBe(expectedHelloContent);
		expect(packageContent).toBe('{"name": "test-project", "version": "1.0.0"}');
		expect(
			await fs.access(sourceFile).then(
				() => true,
				() => false,
			),
		).toBe(true);
	});

	it("handles Windows paths by normalizing to forward slashes", async () => {
		const sources: TarSource[] = [
			{
				type: "content",
				content: "test content",
				target: "folder\\subfolder\\file.txt", // Windows-style path
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "test.tar");
		const destDir = path.join(tmpDir, "extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify path normalization - should create proper directory structure
		const extractedFile = path.join(destDir, "folder", "subfolder", "file.txt");
		const content = await fs.readFile(extractedFile, "utf-8");
		expect(content).toBe("test content");
	});

	it("handles empty sources array", async () => {
		const sources: TarSource[] = [];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "empty.tar");

		await pipeline(archiveStream, createWriteStream(tarPath));

		// Verify tar file was created and has minimal size (just tar footer)
		const stats = await fs.stat(tarPath);
		expect(stats.size).toBeGreaterThan(0);
		expect(stats.size).toBeLessThan(2048); // Should be small for empty archive
	});

	it("preserves file timestamps and modes", async () => {
		// Create a test file with specific timestamp
		const testFile = path.join(tmpDir, "timestamptest.txt");
		await fs.writeFile(testFile, "timestamp test");

		// Set a specific timestamp (Jan 1, 2020)
		const testDate = new Date("2020-01-01T00:00:00Z");
		await fs.utimes(testFile, testDate, testDate);

		const sources: TarSource[] = [
			{
				type: "file",
				source: testFile,
				target: "preserved/file.txt",
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "test.tar");
		const destDir = path.join(tmpDir, "extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify timestamp preservation
		const originalStat = await fs.stat(testFile);
		const extractedStat = await fs.stat(
			path.join(destDir, "preserved", "file.txt"),
		);

		// Compare timestamps (allowing for small differences due to tar precision)
		const originalTime = Math.floor(originalStat.mtime.getTime() / 1000);
		const extractedTime = Math.floor(extractedStat.mtime.getTime() / 1000);
		expect(extractedTime).toBe(originalTime);
		expect(extractedStat.mode).toBe(originalStat.mode);
	});

	it("handles directory with no files", async () => {
		// Create empty directory
		const emptyDir = path.join(tmpDir, "empty");
		await fs.mkdir(emptyDir);

		const sources: TarSource[] = [
			{
				type: "directory",
				source: emptyDir,
				target: "empty-folder",
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "test.tar");
		const destDir = path.join(tmpDir, "extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify empty directory was created
		const extractedDir = path.join(destDir, "empty-folder");
		const stat = await fs.stat(extractedDir);
		expect(stat.isDirectory()).toBe(true);
	});

	it("handles errors gracefully when source file doesn't exist", async () => {
		const sources: TarSource[] = [
			{
				type: "file",
				source: path.join(tmpDir, "nonexistent.txt"),
				target: "missing.txt",
			},
		];

		const archiveStream = packTar(sources);

		// Should reject when trying to read the stream
		await expect(async () => {
			const chunks: Buffer[] = [];
			for await (const chunk of archiveStream) {
				chunks.push(chunk);
			}
		}).rejects.toThrow();
	});

	it("errors for invalid content types", async () => {
		// Test invalid content types that could come from JavaScript usage or dynamic data
		const invalidSources: TarSource[] = [
			{
				type: "content",
				// biome-ignore lint/suspicious/noExplicitAny: Intentionally invalid.
				content: 123 as any, // number
				target: "number.txt",
			},
		];

		const stream = packTar(invalidSources);
		await expect(
			new Promise((resolve, reject) => {
				stream.on("error", reject);
				stream.on("end", resolve);
				stream.resume();
			}),
		).rejects.toThrow(/Unsupported content type/);

		// Test with boolean
		const booleanSources: TarSource[] = [
			{
				type: "content",
				// biome-ignore lint/suspicious/noExplicitAny: Intentionally invalid.
				content: true as any,
				target: "bool.txt",
			},
		];

		const boolStream = packTar(booleanSources);
		await expect(
			new Promise((resolve, reject) => {
				boolStream.on("error", reject);
				boolStream.on("end", resolve);
				boolStream.resume();
			}),
		).rejects.toThrow(/Unsupported content type/);

		// Test with object
		const objectSources: TarSource[] = [
			{
				type: "content",
				// biome-ignore lint/suspicious/noExplicitAny: Intentionally invalid.
				content: { invalid: "object" } as any,
				target: "obj.txt",
			},
		];

		const objStream = packTar(objectSources);
		await expect(
			new Promise((resolve, reject) => {
				objStream.on("error", reject);
				objStream.on("end", resolve);
				objStream.resume();
			}),
		).rejects.toThrow(/Unsupported content type/);
	});

	it("handles StreamSource with custom mode", async () => {
		const content = "Stream with custom mode";
		const readable = Readable.from([Buffer.from(content, "utf-8")]);

		const sources: TarSource[] = [
			{
				type: "stream",
				content: readable,
				target: "custom-mode-stream.txt",
				size: Buffer.byteLength(content, "utf-8"),
				mode: 0o755,
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "custom-mode-stream.tar");
		const destDir = path.join(tmpDir, "custom-mode-stream-extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		const extractedContent = await fs.readFile(
			path.join(destDir, "custom-mode-stream.txt"),
			"utf-8",
		);

		expect(extractedContent).toBe(content);

		// Check that the file mode is correctly set
		const stat = await fs.stat(path.join(destDir, "custom-mode-stream.txt"));
		// File modes work differently on Windows
		if (isWindows) {
			// On Windows, executable permissions are handled differently
			expect(stat.mode & 0o777).toBe(0o666);
		} else {
			expect(stat.mode & 0o777).toBe(0o755);
		}
	});

	it("handles large StreamSource efficiently without OOM", async () => {
		// Create a 10MB stream that generates data on the fly
		const chunkSize = 1024 * 1024; // 1MB chunks
		const totalChunks = 10;
		const totalSize = chunkSize * totalChunks;

		let chunkCount = 0;
		const largeStream = new ReadableStream({
			start(controller) {
				const interval = setInterval(() => {
					if (chunkCount >= totalChunks) {
						clearInterval(interval);
						controller.close();
						return;
					}

					// Generate a 1MB chunk of data
					const chunk = new Uint8Array(chunkSize);
					chunk.fill(65 + (chunkCount % 26)); // Fill with A-Z pattern
					controller.enqueue(chunk);
					chunkCount++;
				}, 1);
			},
		});

		const sources: TarSource[] = [
			{
				type: "stream",
				content: largeStream,
				target: "large-file.bin",
				size: totalSize,
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "large-stream.tar");
		const destDir = path.join(tmpDir, "large-stream-extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify the file was extracted correctly
		const stat = await fs.stat(path.join(destDir, "large-file.bin"));
		expect(stat.size).toBe(totalSize);

		// Verify first few bytes to ensure content integrity
		const handle = await fs.open(path.join(destDir, "large-file.bin"), "r");
		const buffer = Buffer.alloc(1024);
		await handle.read(buffer, 0, 1024, 0);
		await handle.close();

		// First chunk should be filled with 'A' (65)
		expect(buffer[0]).toBe(65);
		expect(buffer[1023]).toBe(65);
	});

	it("throws error for StreamSource with mismatched size", async () => {
		const content = "Short content";
		const readable = Readable.from([Buffer.from(content, "utf-8")]);

		const sources: TarSource[] = [
			{
				type: "stream",
				content: readable,
				target: "mismatched-size.txt",
				size: 1000, // Much larger than actual content
			},
		];

		const archiveStream = packTar(sources);
		const chunks: Buffer[] = [];

		await expect(async () => {
			for await (const chunk of archiveStream) {
				chunks.push(chunk);
			}
		}).rejects.toThrow();
	});

	it("handles multiple StreamSources in mixed archive", async () => {
		const stream1Content = "First stream content";
		const stream2Content = "Second stream content";

		const stream1 = Readable.from([Buffer.from(stream1Content, "utf-8")]);
		const stream2 = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(stream2Content));
				controller.close();
			},
		});

		const sources: TarSource[] = [
			{
				type: "file",
				source: path.join(FIXTURES_DIR, "a", "hello.txt"),
				target: "hello.txt",
			},
			{
				type: "stream",
				content: stream1,
				target: "stream1.txt",
				size: Buffer.byteLength(stream1Content, "utf-8"),
			},
			{
				type: "content",
				content: "Regular content",
				target: "regular.txt",
			},
			{
				type: "stream",
				content: stream2,
				target: "stream2.txt",
				size: Buffer.byteLength(stream2Content, "utf-8"),
			},
		];

		const archiveStream = packTar(sources);
		const tarPath = path.join(tmpDir, "mixed-streams.tar");
		const destDir = path.join(tmpDir, "mixed-streams-extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify all files were extracted correctly
		const helloContent = await fs.readFile(
			path.join(destDir, "hello.txt"),
			"utf-8",
		);
		const stream1ExtractedContent = await fs.readFile(
			path.join(destDir, "stream1.txt"),
			"utf-8",
		);
		const regularContent = await fs.readFile(
			path.join(destDir, "regular.txt"),
			"utf-8",
		);
		const stream2ExtractedContent = await fs.readFile(
			path.join(destDir, "stream2.txt"),
			"utf-8",
		);

		expect(helloContent).toBe(expectedHelloContent);
		expect(stream1ExtractedContent).toBe(stream1Content);
		expect(regularContent).toBe("Regular content");
		expect(stream2ExtractedContent).toBe(stream2Content);
	});

	it("prevents missing size property on StreamSource", async () => {
		const content = "Test content";
		const readable = Readable.from([Buffer.from(content, "utf-8")]);

		const invalidSource = {
			type: "stream",
			content: readable,
			target: "missing-size.txt",
			// biome-ignore lint/suspicious/noExplicitAny: Intentionally invalid.
		} as any;

		const sources: TarSource[] = [invalidSource];

		// The packTar function should handle this gracefully or throw an error
		const archiveStream = packTar(sources);

		await expect(async () => {
			const chunks: Buffer[] = [];
			for await (const chunk of archiveStream) {
				chunks.push(chunk);
			}
		}).rejects.toThrow();
	});
});
