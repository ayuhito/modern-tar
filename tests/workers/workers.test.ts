import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import { packTar } from "../../src/web/helpers";

describe("Cloudflare Workers Integration", () => {
	const createTest = (fixture: string, count: number) => async () => {
		const tarBuffer = await packTar(
			new Array(count).fill(0).map(() => {
				const body = new Uint8Array(64 * 1024).fill(0xaa);
				return {
					header: { name: "test.txt", size: body.length, type: "file" },
					body,
				};
			}),
		);

		const mf = new Miniflare({
			modules: true,
			scriptPath: resolve(__dirname, fixture),
			modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
			compatibilityDate: "2022-11-30",
		});

		try {
			const { readable, writable } = new TransformStream();
			const writer = writable.getWriter();

			const resPromise = mf.dispatchFetch("http://localhost:8787/", {
				method: "POST",
				body: readable,
				// Fetch API requires 'duplex: half' when sending a stream body.
				duplex: "half",
			});

			await writer.write(tarBuffer.subarray(0, 512));
			await new Promise((r) => setTimeout(r, 200));
			await writer.write(tarBuffer.subarray(512));
			await writer.close();

			const res = await resPromise;
			const text = await res.text();
			expect(text).toBe(`Read ${count} entries`);
		} finally {
			await mf.dispose();
		}
	};

	it(
		"should decode using manual reader (1)",
		createTest("worker-fixture.js", 1),
		20000,
	);

	it(
		"should decode using manual reader (2000)",
		createTest("worker-fixture.js", 2000),
		20000,
	);

	it(
		"should decode using async iterator (1)",
		createTest("worker-iterator-fixture.js", 1),
		20000,
	);

	it(
		"should decode using async iterator (2500)",
		createTest("worker-iterator-fixture.js", 2500),
		20000,
	);
});
