import { readFile } from "node:fs/promises";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { decoder } from "../../src/tar/encoding";
import { createTarDecoder } from "../../src/web";
import { chunkBytes } from "../helpers/bytes";
import { MULTI_FILE_TAR } from "./fixtures";

const manifest = [
	["file-1.txt", "i am file-1\n"],
	["file-2.txt", "i am file-2\n"],
] as const;

describe("decoder properties", () => {
	it("reaches every header when each preceding body is consumed or cancelled", () =>
		hegel.testAsync(async (tc) => {
			const width = tc.draw(gs.integers({ minValue: 1, maxValue: 1024 }));
			const actions = tc.draw(
				gs.arrays(gs.sampledFrom(["consume", "cancel"] as const), {
					minSize: manifest.length,
					maxSize: manifest.length,
				}),
			);
			const archive = await readFile(MULTI_FILE_TAR);
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					for (const chunk of chunkBytes(archive, width))
						controller.enqueue(chunk);
					controller.close();
				},
			});
			const reader = stream
				.pipeThrough(createTarDecoder({ strict: true }))
				.getReader();

			for (const [index, [name, body]] of manifest.entries()) {
				const result = await reader.read();
				expect(result.done).toBe(false);
				const entry = result.value;
				if (!entry) throw new Error("Expected decoded entry");
				expect(entry.header.name).toBe(name);

				// The decoder deliberately cannot advance until this body reaches a
				// terminal state. Generate both supported terminal paths for every entry.
				if (actions[index] === "cancel") {
					await entry.body.cancel();
				} else {
					const chunks: Uint8Array[] = [];
					for await (const chunk of entry.body) chunks.push(chunk);
					const bytes = Uint8Array.from(
						chunks.flatMap((chunk) => Array.from(chunk)),
					);
					expect(decoder.decode(bytes)).toBe(body);
				}
			}

			await expect(reader.read()).resolves.toMatchObject({ done: true });
		}));
});
