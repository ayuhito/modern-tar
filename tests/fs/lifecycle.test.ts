import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import * as path from "node:path";
import { Readable, type Writable } from "node:stream";
import { describe, expect } from "vitest";
import { packTar, unpackTar } from "../../src/fs";
import { createDeferred } from "../helpers/deferred";
import { it } from "../helpers/test";

const CHUNK_SIZE = 64 * 1024;
const BUFFER_CHUNKS = (8 * 1024 * 1024) / CHUNK_SIZE;
const SOURCE_CHUNKS = BUFFER_CHUNKS * 2;
const closed = (stream: Readable | Writable) =>
	new Promise<void>((resolve) => stream.once("close", resolve));
const captureErrors = (stream: Readable | Writable) => {
	const errors: unknown[] = [];
	stream.on("error", (error) => errors.push(error));
	return errors;
};
const streamSource = (
	content: Readable | ReadableStream<Uint8Array>,
	target: string,
	size: number,
) => ({ type: "stream" as const, content, target, size });

describe("unpack lifecycle", () => {
	it("closes with the caller-provided destruction error", async ({
		tmpDir,
	}) => {
		const stream = unpackTar(path.join(tmpDir, "extract"));
		const reason = new Error("cancelled");
		const errors = captureErrors(stream);

		const close = closed(stream);
		stream.destroy(reason);
		await close;

		expect(errors).toEqual([reason]);
		expect(stream.destroyed).toBe(true);
	});

	it.for([
		{
			name: "end",
			act: (stream: Writable) => stream.end(),
			error: undefined,
		},
		{
			name: "empty write then end",
			act: (stream: Writable) => stream.end(Buffer.alloc(0)),
			error: undefined,
		},
		{
			name: "end then destroy",
			act: (stream: Writable) => {
				stream.end();
				stream.destroy();
			},
			error: "AbortError",
		},
	])("closes after $name", async ({ act, error }, { tmpDir }) => {
		const stream = unpackTar(path.join(tmpDir, "extract"));
		const errors = captureErrors(stream);

		const close = closed(stream);
		act(stream);
		await close;

		expect(errors.map((value) => (value as Error).name)).toEqual(
			error ? [error] : [],
		);
		expect(stream.closed).toBe(true);
	});

	it("allows repeated end calls", async ({ tmpDir }) => {
		const stream = unpackTar(path.join(tmpDir, "extract"));
		stream.on("error", () => {});
		const close = closed(stream);

		stream.end();
		expect(() => stream.end()).not.toThrow();
		expect(() => stream.end()).not.toThrow();
		await close;
	});

	it("accepts non-Error cancellation reasons from Web Streams", async ({
		tmpDir,
	}) => {
		const stream = unpackTar(path.join(tmpDir, "extract"));
		stream.on("error", () => {});
		const close = closed(stream);

		stream.write(Buffer.from("partial archive"));
		stream.destroy("cancelled" as unknown as Error);

		await close;
		expect(stream.destroyed).toBe(true);
	});
});

describe("pack lifecycle", () => {
	it("closes open file handles before the output closes", async ({
		tmpDir,
	}) => {
		const file = path.join(tmpDir, "small.bin");
		await fsp.writeFile(file, Buffer.alloc(1024));

		const closeStarted = createDeferred();
		const resumeClose = createDeferred();
		const originalOpen = fsp.open;
		fs.promises.open = (async (...args: Parameters<typeof originalOpen>) => {
			const handle = await originalOpen(...args);
			const originalClose = handle.close.bind(handle);
			handle.close = (async () => {
				closeStarted.resolve();
				await resumeClose.promise;
				return originalClose();
			}) as typeof handle.close;
			return handle;
		}) as typeof originalOpen;
		syncBuiltinESMExports();

		const reason = new Error("cancelled");
		const active = new Readable({
			read() {
				this.push(Buffer.alloc(CHUNK_SIZE));
			},
		});
		active.on("error", () => {});
		const output = packTar(
			[
				streamSource(active, "active.bin", SOURCE_CHUNKS * CHUNK_SIZE),
				{ type: "file", source: file, target: "small.bin" },
			],
			{ concurrency: 2 },
		);
		const errors = captureErrors(output);

		try {
			await closeStarted.promise;
			const outputClosed = closed(output);

			output.destroy(reason);
			await Promise.resolve();
			expect(output.closed).toBe(false);

			resumeClose.resolve();
			await outputClosed;
			expect(errors).toEqual([reason]);
		} finally {
			resumeClose.resolve();
			fs.promises.open = originalOpen;
			syncBuiltinESMExports();
		}
	});

	it.each(["output cancellation", "prepared stream error"] as const)(
		"bounds reads and stops owned streams after %s",
		async (failure) => {
			const reason = new Error("cancelled");
			const firstRead = createDeferred();
			const destroyErrors: unknown[] = [];
			let webCancelReason: unknown;
			let pendingCancelReason: unknown;
			let preparedController!: ReadableStreamDefaultController<Uint8Array>;
			let reads = 0;
			const active = new Readable({
				highWaterMark: CHUNK_SIZE,
				read() {
					if (reads === 0) firstRead.resolve();
					if (reads === SOURCE_CHUNKS) this.push(null);
					else {
						reads++;
						this.push(Buffer.alloc(CHUNK_SIZE));
					}
				},
				destroy(error, callback) {
					destroyErrors.push(error);
					callback(error);
				},
			});
			const prepared = new ReadableStream<Uint8Array>({
				start(controller) {
					preparedController = controller;
				},
				cancel(error) {
					webCancelReason = error;
				},
			});
			const pending = new ReadableStream({
				cancel(error) {
					pendingCancelReason = error;
				},
			});
			active.on("error", () => {});

			const output = packTar(
				[
					streamSource(active, "active.bin", SOURCE_CHUNKS * CHUNK_SIZE),
					streamSource(prepared, "prepared.bin", 1),
					streamSource(pending, "pending.bin", 1),
				],
				{ concurrency: 2 },
			);
			const errors = captureErrors(output);

			await firstRead.promise;
			let previousReads: number;
			do {
				previousReads = reads;
				await new Promise<void>((resolve) => setImmediate(resolve));
			} while (reads !== previousReads);

			expect(reads).toBeLessThanOrEqual(BUFFER_CHUNKS + 1);
			expect(prepared.locked).toBe(true);
			// The third stream is outside the preparation window and stays caller-owned.
			expect(pending.locked).toBe(false);
			const outputClosed = closed(output);
			if (failure === "output cancellation") output.destroy(reason);
			else preparedController.error(reason);
			await outputClosed;

			expect(errors).toEqual([reason]);
			expect(destroyErrors).toEqual([reason]);
			if (failure === "output cancellation")
				expect(webCancelReason).toBe(reason);
			expect(pendingCancelReason).toBeUndefined();
			expect(pending.locked).toBe(false);
		},
	);

	it("does not open files after cancellation from a filter", async ({
		tmpDir,
	}) => {
		const file = path.join(tmpDir, "file.bin");
		await fsp.writeFile(file, Buffer.alloc(CHUNK_SIZE));

		let openCalls = 0;
		const originalOpen = fsp.open;
		fs.promises.open = (async (...args: Parameters<typeof originalOpen>) => {
			openCalls++;
			return originalOpen(...args);
		}) as typeof originalOpen;
		syncBuiltinESMExports();

		const reason = new Error("cancelled");
		let output!: Readable;
		try {
			output = packTar([{ type: "file", source: file, target: "file.bin" }], {
				filter() {
					output.destroy(reason);
					return true;
				},
			});
			const errors = captureErrors(output);
			await closed(output);

			expect(errors).toEqual([reason]);
			expect(openCalls).toBe(0);
		} finally {
			fs.promises.open = originalOpen;
			syncBuiltinESMExports();
		}
	});

	it("does not invoke map after cancellation from a filter", async () => {
		const reason = new Error("cancelled");
		let mapCalls = 0;
		let output!: Readable;
		output = packTar(
			[{ type: "content", content: "content", target: "file.txt" }],
			{
				filter() {
					output.destroy(reason);
					return true;
				},
				map(header) {
					mapCalls++;
					return header;
				},
			},
		);
		const errors = captureErrors(output);

		await closed(output);

		expect(errors).toEqual([reason]);
		expect(mapCalls).toBe(0);
	});

	it("does not accept a stream after cancellation from a map", async () => {
		const reason = new Error("cancelled");
		let cancelReason: unknown;
		const pending = new ReadableStream<Uint8Array>({
			cancel(value) {
				cancelReason = value;
			},
		});
		const mapped: string[] = [];
		let output!: Readable;
		// Run one async content job first so the output exists when the map cancels it.
		output = packTar(
			[
				{ type: "content", content: "content", target: "first.txt" },
				streamSource(pending, "pending.txt", 1),
			],
			{
				concurrency: 1,
				map(header) {
					mapped.push(header.name);
					if (header.name === "pending.txt") output.destroy(reason);
					return header;
				},
			},
		);
		const errors = captureErrors(output);

		await closed(output);

		expect(errors).toEqual([reason]);
		expect(mapped).toEqual(["first.txt", "pending.txt"]);
		expect(cancelReason).toBeUndefined();
		expect(pending.locked).toBe(false);
	});

	it("stops callbacks after cancellation during content normalization", async () => {
		const started = createDeferred();
		const resume = createDeferred();
		class DeferredBlob extends Blob {
			override async arrayBuffer() {
				started.resolve();
				await resume.promise;
				return super.arrayBuffer();
			}
		}
		const reason = new Error("cancelled");
		const callbacks: string[] = [];
		const output = packTar(
			[
				{
					type: "content",
					content: new DeferredBlob(["content"]),
					target: "file.txt",
				},
			],
			{
				filter() {
					callbacks.push("filter");
					return true;
				},
				map(header) {
					callbacks.push("map");
					return header;
				},
			},
		);
		const errors = captureErrors(output);

		await started.promise;
		const outputClosed = closed(output);
		output.destroy(reason);
		resume.resolve();
		await outputClosed;
		await new Promise<void>((resolve) => setImmediate(resolve));

		expect(errors).toEqual([reason]);
		expect(callbacks).toEqual([]);
	});
});
