import * as path from "node:path";
import type { Writable } from "node:stream";
import { describe, expect } from "vitest";
import { unpackTar } from "../../src/fs";
import { it } from "../helpers/test";

const closed = (stream: Writable) =>
	new Promise<void>((resolve) => stream.once("close", resolve));

describe("unpack lifecycle", () => {
	it("closes with the caller-provided destruction error", async ({
		tmpDir,
	}) => {
		const stream = unpackTar(path.join(tmpDir, "extract"));
		const reason = new Error("cancelled");
		const errors: unknown[] = [];
		stream.on("error", (error) => errors.push(error));

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
		const errors: unknown[] = [];
		stream.on("error", (error) => errors.push(error));

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
