import { createTarDecoder } from "../../dist/web/index.js";

export default {
	async fetch(request) {
		if (!request.body) {
			return new Response("Request body is required.", { status: 500 });
		}

		let count = 0;
		let totalBytes = 0;
		let bodyByteTotal = 0;
		let firstName = null;
		let lastName = null;

		try {
			for await (const entry of request.body.pipeThrough(createTarDecoder())) {
				const reader = entry.body.getReader();
				let bodyLength = 0;
				let entryByteTotal = 0;

				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;

						bodyLength += value.length;
						for (const byte of value) {
							entryByteTotal += byte;
						}
					}
				} finally {
					reader.releaseLock();
				}

				if (firstName === null) firstName = entry.header.name;
				lastName = entry.header.name;
				count++;
				totalBytes += bodyLength;
				bodyByteTotal += entryByteTotal;
			}

			return Response.json({
				count,
				totalBytes,
				bodyByteTotal,
				firstName,
				lastName,
			});
		} catch (error) {
			return new Response(String(error), { status: 500 });
		}
	},
};
