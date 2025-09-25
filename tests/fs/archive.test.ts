import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packTarSources, type TarSource, unpackTar } from "../../src/fs/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

describe("packTarSources", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "modern-tar-archive-test-"),
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

		const archiveStream = packTarSources(sources);
		const tarPath = path.join(tmpDir, "test.tar");
		const destDir = path.join(tmpDir, "extracted");

		// Write tar to file and extract
		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify extraction
		const extractedFile = path.join(destDir, "output", "hello.txt");
		const content = await fs.readFile(extractedFile, "utf-8");
		expect(content).toBe("hello world\n");

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

		const archiveStream = packTarSources(sources);
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

		expect(helloContent).toBe("hello world\n");
		expect(testContent).toBe("test\n");
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

		const archiveStream = packTarSources(sources);
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
				const encoder = new TextEncoder();
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
				type: "content",
				content: stream,
				target: "types/stream.txt",
			},
			{
				type: "content",
				content: null,
				target: "types/empty.txt",
			},
		];

		const archiveStream = packTarSources(sources);
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

	it("packs content source with custom mode", async () => {
		const sources: TarSource[] = [
			{
				type: "content",
				content: "#!/bin/bash\necho 'executable script'",
				target: "bin/script.sh",
				mode: 0o755, // Executable permissions
			},
		];

		const archiveStream = packTarSources(sources);
		const tarPath = path.join(tmpDir, "test.tar");
		const destDir = path.join(tmpDir, "extracted");

		await pipeline(archiveStream, createWriteStream(tarPath));
		const unpackStream = unpackTar(destDir);
		await pipeline(createReadStream(tarPath), unpackStream);

		// Verify file mode
		const extractedStat = await fs.stat(path.join(destDir, "bin", "script.sh"));
		expect(extractedStat.mode & 0o777).toBe(0o755);
	});

	it("packs directory sources", async () => {
		const sources: TarSource[] = [
			{
				type: "directory",
				source: path.join(FIXTURES_DIR, "b"),
				target: "project/src",
			},
		];

		const archiveStream = packTarSources(sources);
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
		expect(content).toBe("test\n");
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

		const archiveStream = packTarSources(sources);
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

		expect(readmeContent).toBe("hello world\n");
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

		const archiveStream = packTarSources(sources);
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

		const archiveStream = packTarSources(sources);
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

		const archiveStream = packTarSources(sources);
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

		const archiveStream = packTarSources(sources);
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

		const archiveStream = packTarSources(sources);

		// Should reject when trying to read the stream
		await expect(async () => {
			const chunks: Buffer[] = [];
			for await (const chunk of archiveStream) {
				chunks.push(chunk);
			}
		}).rejects.toThrow();
	});
});
