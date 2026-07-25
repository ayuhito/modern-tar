import { describe, expect, it } from "vitest";
import { decoder, encoder } from "../../src/tar/encoding";
import { createTarPacker, unpackTar } from "../../src/web";

describe("native compression streams", () => {
	it("round-trips shared input without consumer assertions", async () => {
		const { readable, controller } = createTarPacker();
		const compressedStream = readable
			.pipeThrough(
				new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
					transform(chunk, streamController) {
						expect(chunk.buffer).toBeInstanceOf(ArrayBuffer);
						streamController.enqueue(chunk);
					},
				}),
			)
			.pipeThrough(new CompressionStream("gzip"))
			.pipeThrough(new DecompressionStream("gzip"));

		const entriesPromise = unpackTar(compressedStream);
		const sharedBody = new Uint8Array(new SharedArrayBuffer(5));
		sharedBody.set(encoder.encode("hello"));

		const fileStream = controller.add({
			name: "file.txt",
			size: sharedBody.length,
			type: "file",
		});
		const writer = fileStream.getWriter();
		await writer.write(sharedBody);
		await writer.close();
		controller.finalize();

		const entries = await entriesPromise;
		expect(entries).toHaveLength(1);
		expect(entries[0].header.name).toBe("file.txt");
		expect(decoder.decode(entries[0].data)).toBe("hello");
	});
});
