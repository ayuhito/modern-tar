import { createTarDecoder } from "../../dist/web/index.js";

export default {
	async fetch(request) {
		const decoder = createTarDecoder();
		const entries = request.body.pipeThrough(decoder);
		let count = 0;
		try {
			for await (const entry of entries) {
				count++;
				const reader = entry.body.getReader();
				while (true) {
					const { done } = await reader.read();
					if (done) break;
				}
			}
			return new Response(`Read ${count} entries`);
		} catch (e) {
			return new Response(e.message, { status: 500 });
		}
	},
};
