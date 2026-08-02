import { describe, expect, it } from "vitest";
import { createTarPacker } from "../../src/web";

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

	it("cannot finalize while an entry is active", async () => {
		const { readable, controller } = createTarPacker();
		const streamError = observeReadableError(readable);
		controller.add({ name: "file", size: 1 });

		expect(() => controller.finalize()).toThrow(
			"Cannot finalize while an entry is still active",
		);
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
});
