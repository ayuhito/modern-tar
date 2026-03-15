import { unpackTar } from "../../dist/web/index.js";

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
			for (const entry of await unpackTar(request.body)) {
				const data = entry.data ?? new Uint8Array(0);
				if (firstName === null) firstName = entry.header.name;
				lastName = entry.header.name;
				count++;
				totalBytes += data.length;
				for (const byte of data) {
					bodyByteTotal += byte;
				}
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
