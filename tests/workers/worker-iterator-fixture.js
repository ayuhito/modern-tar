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
				let bodyLength = 0;
				let entryByteTotal = 0;

				for await (const chunk of entry.body) {
					bodyLength += chunk.length;
					for (const byte of chunk) {
						entryByteTotal += byte;
					}
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
