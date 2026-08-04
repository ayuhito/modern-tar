import { describe, expect, it } from "vitest";
import { createTarPacker } from "../../src/web";
import { blockPackerOutput } from "../helpers/packer";

const observeReadableError = (readable: ReadableStream<Uint8Array>) => {
	const reader = readable.getReader();
	return reader.closed.catch((error) => error);
};

describe("createTarPacker", () => {
	it("requires the active entry to finish before adding another", async () => {
		const { readable, controller } = createTarPacker();
		const streamError = observeReadableError(readable);
		controller.add({ name: "first", size: 1 });

		expect(() => controller.add({ name: "second", size: 0 })).toThrow(
			"Previous entry must be completed",
		);
		await expect(streamError).resolves.toBeInstanceOf(Error);
	});

	it("rejects body overflow and underflow", async () => {
		for (const [body, message] of [
			[Uint8Array.of(1, 2), "exceeds given size"],
			[Uint8Array.of(), "Size mismatch"],
		] as const) {
			const { readable, controller } = createTarPacker();
			const streamError = observeReadableError(readable);
			const writer = controller.add({ name: "file", size: 1 }).getWriter();

			if (body.length > 1) {
				await expect(writer.write(body)).rejects.toThrow(message);
			} else {
				await expect(writer.close()).rejects.toThrow(message);
			}
			await expect(streamError).resolves.toBeInstanceOf(Error);
		}
	});

	it("keeps a bodyless entry active until its writable closes", async () => {
		const { readable, controller } = createTarPacker();
		const streamError = observeReadableError(readable);
		const writer = controller
			.add({ name: "directory/", size: 0, type: "directory" })
			.getWriter();
		const writerClosed = writer.closed.catch((error) => error);

		expect(() => controller.finalize()).toThrow(
			"Cannot finalize while an entry is still active",
		);
		await expect(writerClosed).resolves.toBeInstanceOf(Error);
		await expect(streamError).resolves.toBeInstanceOf(Error);
	});

	it("rejects repeated finalization and entries added after finalization", async () => {
		for (const operation of ["finalize", "add"] as const) {
			const { readable, controller } = createTarPacker();
			const streamError = observeReadableError(readable);
			controller.finalize();

			if (operation === "finalize") {
				expect(() => controller.finalize()).toThrow("already been finalized");
			} else {
				expect(() => controller.add({ name: "late", size: 0 })).toThrow(
					"No new tar entries after finalize",
				);
			}
			await expect(streamError).resolves.toBeInstanceOf(Error);
		}
	});

	it("propagates explicit controller errors", async () => {
		const { readable, controller } = createTarPacker();
		const streamError = observeReadableError(readable);
		const reason = new Error("packing failed");

		controller.error(reason);
		await expect(streamError).resolves.toBe(reason);
	});

	it("waits for output demand and cancels the active entry", async () => {
		const { readable, controller } = createTarPacker();
		const reader = readable.getReader();
		const { chunk, writer, write } = await blockPackerOutput(controller);
		const writerClosed = writer.closed.catch((error) => error);
		let settled = false;
		write.then(() => {
			settled = true;
		});

		await Promise.resolve();
		expect(settled).toBe(false);
		expect((await reader.read()).value).toHaveLength(512);
		await Promise.resolve();
		expect(settled).toBe(false);
		expect((await reader.read()).value).toBe(chunk);
		await write;

		const reason = null;
		await reader.cancel(reason);
		await expect(writerClosed).resolves.toBe(reason);
	});

	it("aborts an active entry while output demand is blocked", async () => {
		const { readable, controller } = createTarPacker();
		const streamError = observeReadableError(readable);
		const { writer, write } = await blockPackerOutput(controller);
		const writeError = write.catch((error) => error);
		const reason = new Error("cancelled");

		await writer.abort(reason);
		await expect(writeError).resolves.toBe(reason);
		await expect(streamError).resolves.toBe(reason);
	});

	it("uses AbortError when an idle entry is aborted without a reason", async () => {
		const { readable, controller } = createTarPacker();
		const streamError = observeReadableError(readable);
		const writer = controller.add({ name: "file", size: 1 }).getWriter();

		await writer.abort();
		await expect(streamError).resolves.toMatchObject({ name: "AbortError" });
	});

	it("uses AbortError when output is cancelled without a reason", async () => {
		const { readable, controller } = createTarPacker();
		const writer = controller.add({ name: "file", size: 1 }).getWriter();
		const writerClosed = writer.closed.catch((error) => error);

		await readable.cancel();
		await expect(writerClosed).resolves.toMatchObject({ name: "AbortError" });
	});
});
