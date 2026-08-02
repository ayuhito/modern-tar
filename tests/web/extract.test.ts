import * as fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BLOCK_SIZE, USTAR_CHECKSUM_OFFSET } from "../../src/tar/constants";
import { decoder, encoder } from "../../src/tar/encoding";
import { createTarHeader } from "../../src/tar/header";

import { createTarDecoder, packTar, unpackTar } from "../../src/web";
import { chunkBytes } from "../helpers/bytes";
import { createDeferred } from "../helpers/deferred";
import {
	INCOMPLETE_TAR,
	MULTI_FILE_TAR,
	ONE_FILE_TAR,
	TYPES_TAR,
} from "./fixtures";

const readWithTimeout = <T>(
	promise: Promise<T>,
	message: string,
	ms = 100,
): Promise<T> =>
	Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(message)), ms),
		),
	]);

const expectToStayPending = async <T>(
	promise: Promise<T>,
	ms = 50,
): Promise<void> => {
	const pending = Symbol("pending");
	const result = await Promise.race([
		promise,
		new Promise<typeof pending>((resolve) =>
			setTimeout(() => resolve(pending), ms),
		),
	]);

	expect(result).toBe(pending);
};

describe("unpackTar", () => {
	it("extracts a single file tar", async () => {
		const buffer = await fs.readFile(ONE_FILE_TAR);
		const entries = await unpackTar(buffer);

		expect(entries).toHaveLength(1);
		const [entry] = entries;

		expect(entry.header.name).toBe("test.txt");
		expect(entry.header.size).toBe(12);
		expect(entry.header.type).toBe("file");
		expect(entry.header.mode).toBe(0o644);
		expect(entry.header.uid).toBe(501);
		expect(entry.header.gid).toBe(20);
		expect(entry.header.mtime).toEqual(new Date(1387580181000));
		expect(entry.header.uname).toBe("maf");
		expect(entry.header.gname).toBe("staff");
		expect(decoder.decode(entry.data)).toBe("hello world\n");
	});

	it("extracts a multi-file tar", async () => {
		const buffer = await fs.readFile(MULTI_FILE_TAR);
		const entries = await unpackTar(buffer);

		expect(entries).toHaveLength(2);
		expect(entries[0].header.name).toBe("file-1.txt");
		expect(decoder.decode(entries[0].data)).toBe("i am file-1\n");
		expect(entries[1].header.name).toBe("file-2.txt");
		expect(decoder.decode(entries[1].data)).toBe("i am file-2\n");
	});

	it("returns file data independent from the source archive buffer", async () => {
		const archive = await packTar([
			{ header: { name: "file.txt", type: "file", size: 5 }, body: "hello" },
		]);
		const [entry] = await unpackTar(archive);
		const data = entry.data;
		expect(data).toBeDefined();
		if (!data) throw new Error("Expected file data");

		data[0] = "x".charCodeAt(0);
		expect(archive[BLOCK_SIZE]).toBe("h".charCodeAt(0));

		archive[BLOCK_SIZE] = "y".charCodeAt(0);
		expect(data[0]).toBe("x".charCodeAt(0));
	});

	it("does not retain impossible file sizes for non-strict data", async () => {
		const archive = createTarHeader({
			name: "huge.bin",
			type: "file",
			size: 1024 * 1024,
		});
		const [entry] = await unpackTar(archive, { strict: false });

		expect(entry.data?.buffer.byteLength).toBe(0);

		const paxArchive = await packTar([
			{
				header: {
					name: "negative-pax-size.txt",
					type: "file",
					size: 1,
					pax: { size: "-1" },
				},
				body: "x",
			},
		]);
		const [paxEntry] = await unpackTar(paxArchive, { strict: false });

		expect(paxEntry.header.size).toBe(1);
		expect(decoder.decode(paxEntry.data)).toBe("x");
	});

	it("extracts a tar with various entry types (directory, symlink)", async () => {
		const buffer = await fs.readFile(TYPES_TAR);
		const entries = await unpackTar(buffer);

		expect(entries).toHaveLength(2);
		const [dir, link] = entries;

		expect(dir.header.name).toBe("directory");
		expect(dir.header.type).toBe("directory");
		expect(dir.header.size).toBe(0);

		expect(link.header.name).toBe("directory-link");
		expect(link.header.type).toBe("symlink");
		expect(link.header.linkname).toBe("directory");
	});

	it("throws an error for an incomplete archive in strict mode", async () => {
		const buffer = await fs.readFile(INCOMPLETE_TAR);
		await expect(unpackTar(buffer, { strict: true })).rejects.toThrow(
			"Tar archive is truncated.",
		);
	});

	it("handles an incomplete archive gracefully in non-strict mode", async () => {
		const buffer = await fs.readFile(INCOMPLETE_TAR);
		const entries = await unpackTar(buffer, { strict: false });

		expect(entries).toHaveLength(1);
		expect(entries[0].header.name).toBe("file-1.txt");
	});

	it("should ignore extra data after the final null blocks in non-strict mode", async () => {
		const archive = await packTar([
			{ header: { name: "test.txt", type: "file", size: 5 }, body: "hello" },
		]);
		const extraData = new Uint8Array([1, 2, 3]);
		const combined = new Uint8Array(archive.length + extraData.length);
		combined.set(archive);
		combined.set(extraData, archive.length);

		const entries = await unpackTar(combined, { strict: false });
		expect(entries).toHaveLength(1);
		expect(entries[0].header.name).toBe("test.txt");
	});
});

describe("createTarDecoder", () => {
	it("streams entries as data arrives", async () => {
		const archive = await packTar([
			{ header: { name: "file.txt", type: "file", size: 5 }, body: "hello" },
			{ header: { name: "dir/", type: "directory", size: 0 } },
			{
				header: { name: "dir/nested.txt", type: "file", size: 3 },
				body: new Uint8Array([97, 98, 99]),
			},
		]);

		const decoder = createTarDecoder();
		const reader = decoder.readable.getReader();
		const writer = decoder.writable.getWriter();

		const splitPoint = Math.floor((archive.length * 2) / 3);
		const firstPart = archive.subarray(0, splitPoint);

		const firstResultPromise = Promise.race([
			reader.read(),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error("Timed out waiting for first entry")),
					100,
				),
			),
		]);

		await writer.write(firstPart);
		const firstResult = await firstResultPromise;
		expect(firstResult.done).toBe(false);
		const firstEntry = firstResult.value;
		if (!firstEntry) throw new Error("Expected first entry");
		expect(firstEntry.header.name).toBe("file.txt");

		await firstEntry.body.cancel();

		const names = [firstEntry.header.name];

		for (let i = 0; i < 2; i++) {
			const nextResult = await Promise.race([
				reader.read(),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("Timed out waiting for next entry")),
						100,
					),
				),
			]);
			expect(nextResult.done).toBe(false);
			const entry = nextResult.value;
			if (!entry) throw new Error("Expected streamed entry");

			names.push(entry.header.name);

			if (entry.header.size > 0) await entry.body.cancel();
		}

		expect(names).toEqual(["file.txt", "dir/", "dir/nested.txt"]);
	});

	it("iterate over headers by cancelling", async () => {
		const archive = await packTar([
			{ header: { name: "dir/", type: "directory", size: 0 } },
			{
				header: { name: "dir/file.txt", type: "file", size: 5 },
				body: "hello",
			},
			{
				header: { name: "dir/empty.txt", type: "file", size: 0 },
				body: new Uint8Array(),
			},
		]);

		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(archive);
				controller.close();
			},
		});

		const decoder = createTarDecoder();
		const entryStream = stream.pipeThrough(decoder);

		const names: string[] = [];
		for await (const entry of entryStream) {
			names.push(entry.header.name);
			await entry.body?.cancel();
		}

		expect(names).toEqual(["dir/", "dir/file.txt", "dir/empty.txt"]);
	});

	it("pauses body streaming until the current entry is cancelled", async () => {
		const archive = await packTar([
			{
				header: { name: "large.bin", type: "file", size: 2048 },
				body: new Uint8Array(2048).fill(97),
			},
			{ header: { name: "after.txt", type: "file", size: 5 }, body: "hello" },
		]);

		const decoder = createTarDecoder();
		const reader = decoder.readable.getReader();
		const writer = decoder.writable.getWriter();

		const writeAll = (async () => {
			for (const fragment of chunkBytes(archive, 128)) {
				await writer.write(fragment);
			}
		})();

		const firstResult = await readWithTimeout(
			reader.read(),
			"Timed out waiting for first entry",
		);
		expect(firstResult.done).toBe(false);
		const firstEntry = firstResult.value;
		if (!firstEntry) throw new Error("Expected first entry");
		expect(firstEntry.header.name).toBe("large.bin");

		await writeAll;

		const secondReadPromise = reader.read();
		await expectToStayPending(secondReadPromise);

		await firstEntry.body.cancel();

		const secondResult = await readWithTimeout(
			secondReadPromise,
			"Timed out waiting for second entry",
		);
		expect(secondResult.done).toBe(false);
		const secondEntry = secondResult.value;
		if (!secondEntry) throw new Error("Expected second entry");
		expect(secondEntry.header.name).toBe("after.txt");

		await secondEntry.body.cancel();
		await writer.close();

		const finalRead = await readWithTimeout(
			reader.read(),
			"Timed out waiting for decoder completion",
		);
		expect(finalRead.done).toBe(true);
	});

	it("propagates unread body backpressure and cancellation to the source", async () => {
		const body = new Uint8Array(8 * 1024 * 1024).fill(97);
		const archive = await packTar([
			{
				header: { name: "large.bin", type: "file", size: body.length },
				body,
			},
		]);
		const chunkSize = 64 * 1024;
		let pulledChunks = 0;
		const sourceFragments = chunkBytes(archive, chunkSize)[Symbol.iterator]();
		const sourceCanceled = createDeferred();
		const source = new ReadableStream<Uint8Array>({
			pull(controller) {
				const { done, value } = sourceFragments.next();
				if (done) return controller.close();
				pulledChunks++;
				controller.enqueue(value);
			},
			cancel: () => sourceCanceled.resolve(),
		});
		const reader = source.pipeThrough(createTarDecoder()).getReader();
		const result = await reader.read();
		if (!result.value) throw new Error("Expected first entry");
		const bodyReader = result.value.body.getReader();

		await expectToStayPending(bodyReader.closed);
		const pulledBeforeCancel = pulledChunks;
		await reader.cancel();
		await readWithTimeout(
			sourceCanceled.promise,
			"Timed out waiting for source cancellation",
		);

		const maxBufferedChunks = (1024 * 1024) / chunkSize;
		expect(pulledBeforeCancel).toBeLessThanOrEqual(maxBufferedChunks + 2);
	});

	it("aborts while an unread body backpressures the writable side", async () => {
		const body = new Uint8Array(2 * 1024 * 1024).fill(97);
		const archive = await packTar([
			{
				header: { name: "large.bin", type: "file", size: body.length },
				body,
			},
		]);
		const chunkSize = 64 * 1024;
		const decoder = createTarDecoder();
		const reader = decoder.readable.getReader();
		const writer = decoder.writable.getWriter();

		await writer.write(archive.subarray(0, chunkSize));
		const result = await readWithTimeout(
			reader.read(),
			"Timed out waiting for entry before abort",
		);
		if (!result.value) throw new Error("Expected first entry");
		const readerClosed = reader.closed.then(
			() => null,
			(error) => error,
		);

		const writes: Promise<void>[] = [];
		for (const fragment of chunkBytes(archive, chunkSize, chunkSize)) {
			writes.push(writer.write(fragment));
		}
		const writesSettled = Promise.allSettled(writes);
		await expectToStayPending(writesSettled);

		const reason = new Error("Abort decoder");
		await readWithTimeout(
			writer.abort(reason),
			"Timed out aborting backpressured decoder",
		);
		await writesSettled;
		expect(await readerClosed).toBe(reason);
	});

	it("continues serving buffered headers before the source closes", async () => {
		const archive = await packTar([
			{ header: { name: "one/", type: "directory", size: 0 } },
			{ header: { name: "two/", type: "directory", size: 0 } },
			{ header: { name: "three/", type: "directory", size: 0 } },
			{ header: { name: "four/", type: "directory", size: 0 } },
		]);

		const decoder = createTarDecoder();
		const reader = decoder.readable.getReader();
		const writer = decoder.writable.getWriter();

		await writer.write(archive);

		const firstResult = await readWithTimeout(
			reader.read(),
			"Timed out waiting for first unread header",
		);
		expect(firstResult.done).toBe(false);
		expect(firstResult.value?.header.name).toBe("one/");

		const secondResult = await readWithTimeout(
			reader.read(),
			"Timed out waiting for second unread header",
		);
		expect(secondResult.done).toBe(false);
		expect(secondResult.value?.header.name).toBe("two/");

		const thirdResult = await readWithTimeout(
			reader.read(),
			"Timed out waiting for third buffered header",
		);
		expect(thirdResult.done).toBe(false);
		expect(thirdResult.value?.header.name).toBe("three/");

		const fourthResult = await readWithTimeout(
			reader.read(),
			"Timed out waiting for fourth buffered header",
		);
		expect(fourthResult.done).toBe(false);
		expect(fourthResult.value?.header.name).toBe("four/");

		const finalReadPromise = reader.read();
		await expectToStayPending(finalReadPromise);

		await writer.close();

		const finalRead = await readWithTimeout(
			finalReadPromise,
			"Timed out waiting for decoder completion",
		);
		expect(finalRead.done).toBe(true);
	});

	it("flushes trailing buffered entries when the source closes", async () => {
		const archive = await packTar([
			{ header: { name: "one/", type: "directory", size: 0 } },
			{ header: { name: "two/", type: "directory", size: 0 } },
			{ header: { name: "three/", type: "directory", size: 0 } },
		]);

		const decoder = createTarDecoder();
		const reader = decoder.readable.getReader();
		const writer = decoder.writable.getWriter();

		await writer.write(archive);
		await writer.close();

		const names: string[] = [];
		for (let i = 0; i < 3; i++) {
			const result = await readWithTimeout(
				reader.read(),
				"Timed out waiting for flushed entry",
			);
			expect(result.done).toBe(false);
			if (!result.value) throw new Error("Expected flushed entry");
			names.push(result.value.header.name);
		}

		expect(names).toEqual(["one/", "two/", "three/"]);

		const finalRead = await readWithTimeout(
			reader.read(),
			"Timed out waiting for decoder completion",
		);
		expect(finalRead.done).toBe(true);
	});

	it("rejects a stream with an invalid checksum in strict mode", async () => {
		const archive = await packTar([
			{ header: { name: "test.txt", type: "file", size: 0 }, body: "" },
		]);
		// Corrupt the checksum
		archive.set(encoder.encode("INVALID!"), USTAR_CHECKSUM_OFFSET);

		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(archive);
				controller.close();
			},
		});

		const decoder = createTarDecoder({ strict: true });
		await expect(
			stream.pipeThrough(decoder).getReader().read(),
		).rejects.toThrow("Invalid tar header checksum");
	});

	it("rejects a stream with unexpected data at the end in strict mode", async () => {
		const archive = await packTar([
			{ header: { name: "test.txt", type: "file", size: 1 }, body: "h" },
		]);
		const stream = new ReadableStream({
			start(controller) {
				// End the archive correctly, but then add extra junk data
				controller.enqueue(archive);
				controller.enqueue(new Uint8Array([1, 2, 3, 4]));
				controller.close();
			},
		});

		const decoder = createTarDecoder({ strict: true });
		const reader = stream.pipeThrough(decoder).getReader();
		await reader.read(); // Read the valid entry
		await expect(reader.read()).rejects.toThrow("Invalid EOF.");
	});

	it("rejects a stream truncated mid-entry in strict mode", async () => {
		const archive = await packTar([
			{
				header: { name: "test.txt", size: 10, type: "file" },
				body: "1234567890",
			},
		]);
		// Truncate the archive in the middle of the file's data block
		const truncated = archive.slice(0, BLOCK_SIZE + 5);

		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(truncated);
				controller.close();
			},
		});

		const decoder = createTarDecoder({ strict: true });
		await expect(
			stream.pipeThrough(decoder).pipeTo(new WritableStream()),
		).rejects.toThrow("Tar archive is truncated");
	});

	it("gracefully handles a stream truncated mid-entry in non-strict mode", async () => {
		const archive = await packTar([
			{
				header: { name: "test.txt", size: 10, type: "file" },
				body: "1234567890",
			},
		]);
		const truncated = archive.slice(0, BLOCK_SIZE + 5);

		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(truncated);
				controller.close();
			},
		});

		const decoder = createTarDecoder({ strict: false });
		const reader = stream.pipeThrough(decoder).getReader();

		const { value: entry } = await reader.read();
		expect(entry?.header.name).toBe("test.txt");

		if (!entry) throw new Error("Entry is undefined");

		const bodyReader = entry.body.getReader();
		const chunk1 = await bodyReader.read();
		expect(new TextDecoder().decode(chunk1.value)).toBe("12345"); // Read the 5 available bytes

		const chunk2 = await bodyReader.read();
		expect(chunk2.done).toBe(true); // Stream ends gracefully

		const finalRead = await reader.read();
		expect(finalRead.done).toBe(true);
	});
});
