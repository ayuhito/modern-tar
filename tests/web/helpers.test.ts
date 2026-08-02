import { describe, expect, it } from "vitest";
import { streamToBuffer } from "../../src/web/stream-utils";

describe("web helpers", () => {
	it("propagates stream errors", async () => {
		const reason = new Error("stream failed");
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(reason);
			},
		});

		await expect(streamToBuffer(stream)).rejects.toBe(reason);
	});
});
