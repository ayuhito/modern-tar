import { createTarDecoder } from "../../dist/web/index.js";

export default {
	async fetch(request) {
		const decoder = createTarDecoder();
		const entries = request.body.pipeThrough(decoder);
		let count = 0;
		try {
			for await (const entry of entries) {
				count++;
				for await (const _ of entry.body) {
					// Just consume
				}
			}
			return new Response(`Read ${count} entries`);
		} catch (e) {
			return new Response(e.message, { status: 500 });
		}
	},
};
