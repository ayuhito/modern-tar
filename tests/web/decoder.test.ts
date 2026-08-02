import { describe, expect, it } from "vitest";
import { BLOCK_SIZE, USTAR_CHECKSUM_OFFSET } from "../../src/tar/constants";
import { encoder } from "../../src/tar/encoding";
import { createTarDecoder, packTar } from "../../src/web";
import { chunkBytes, streamFromChunks } from "../helpers/bytes";
import { createDeferred } from "../helpers/deferred";

const expectPending = async <T>(promise: Promise<T>): Promise<void> => {
	let settled = false;
	void promise.then(
		() => (settled = true),
		() => (settled = true),
	);
	await Promise.resolve();
	expect(settled).toBe(false);
};

describe("createTarDecoder", () => {
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

		const firstResult = await reader.read();
		expect(firstResult.done).toBe(false);
		const firstEntry = firstResult.value;
		if (!firstEntry) throw new Error("Expected first entry");
		expect(firstEntry.header.name).toBe("large.bin");

		await writeAll;

		const secondReadPromise = reader.read();
		await expectPending(secondReadPromise);

		await firstEntry.body.cancel();

		const secondResult = await secondReadPromise;
		expect(secondResult.done).toBe(false);
		const secondEntry = secondResult.value;
		if (!secondEntry) throw new Error("Expected second entry");
		expect(secondEntry.header.name).toBe("after.txt");

		await secondEntry.body.cancel();
		await writer.close();

		const finalRead = await reader.read();
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

		await expectPending(bodyReader.closed);
		const pulledBeforeCancel = pulledChunks;
		await reader.cancel();
		await sourceCanceled.promise;

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
		const result = await reader.read();
		if (!result.value) throw new Error("Expected first entry");
		const readerClosed = reader.closed.then(
			() => null,
			(error) => error,
		);

		const fragments = Array.from(chunkBytes(archive, chunkSize, chunkSize));
		// Fifteen more chunks leave the unread buffer just below 1 MiB. The next
		// write crosses the decoder limit and gives us a deterministic abort gate.
		for (const fragment of fragments.slice(0, 15)) await writer.write(fragment);
		const blockedWrite = writer.write(fragments[15]);
		await expectPending(blockedWrite);

		const reason = new Error("Abort decoder");
		await writer.abort(reason);
		await Promise.allSettled([blockedWrite]);
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

		const firstResult = await reader.read();
		expect(firstResult.done).toBe(false);
		expect(firstResult.value?.header.name).toBe("one/");

		const secondResult = await reader.read();
		expect(secondResult.done).toBe(false);
		expect(secondResult.value?.header.name).toBe("two/");

		const thirdResult = await reader.read();
		expect(thirdResult.done).toBe(false);
		expect(thirdResult.value?.header.name).toBe("three/");

		const fourthResult = await reader.read();
		expect(fourthResult.done).toBe(false);
		expect(fourthResult.value?.header.name).toBe("four/");

		const finalReadPromise = reader.read();
		await expectPending(finalReadPromise);

		await writer.close();

		const finalRead = await finalReadPromise;
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
			const result = await reader.read();
			expect(result.done).toBe(false);
			if (!result.value) throw new Error("Expected flushed entry");
			names.push(result.value.header.name);
		}

		expect(names).toEqual(["one/", "two/", "three/"]);

		const finalRead = await reader.read();
		expect(finalRead.done).toBe(true);
	});

	it("rejects a stream with an invalid checksum in strict mode", async () => {
		const archive = await packTar([
			{ header: { name: "test.txt", type: "file", size: 0 }, body: "" },
		]);
		// Corrupt the checksum
		archive.set(encoder.encode("INVALID!"), USTAR_CHECKSUM_OFFSET);

		const decoder = createTarDecoder({ strict: true });
		await expect(
			streamFromChunks([archive]).pipeThrough(decoder).getReader().read(),
		).rejects.toThrow("Invalid tar header checksum");
	});

	it("rejects a stream with unexpected data at the end in strict mode", async () => {
		const archive = await packTar([
			{ header: { name: "test.txt", type: "file", size: 1 }, body: "h" },
		]);

		const decoder = createTarDecoder({ strict: true });
		const reader = streamFromChunks([archive, Uint8Array.of(1, 2, 3, 4)])
			.pipeThrough(decoder)
			.getReader();
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

		const decoder = createTarDecoder({ strict: true });
		await expect(
			streamFromChunks([truncated])
				.pipeThrough(decoder)
				.pipeTo(new WritableStream()),
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

		const decoder = createTarDecoder({ strict: false });
		const reader = streamFromChunks([truncated])
			.pipeThrough(decoder)
			.getReader();

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
