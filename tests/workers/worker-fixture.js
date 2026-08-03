import { createTarDecoder, packTar, unpackTar } from "../../dist/web/index.js";

const bodyStats = async (body, mode) => {
	let totalBytes = 0;
	let bodyByteTotal = 0;
	const add = (chunk) => {
		totalBytes += chunk.length;
		for (const byte of chunk) bodyByteTotal += byte;
	};

	if (body instanceof Uint8Array) {
		add(body);
	} else if (mode === "response") {
		add(new Uint8Array(await new Response(body).arrayBuffer()));
	} else if (mode === "reader") {
		const reader = body.getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				add(value);
			}
		} finally {
			reader.releaseLock();
		}
	} else {
		for await (const chunk of body) add(chunk);
	}

	return { totalBytes, bodyByteTotal };
};

export default {
	async fetch(request) {
		const mode = new URL(request.url).searchParams.get("mode") ?? "response";
		if (mode === "pack") {
			return new Response(
				await packTar([
					{
						header: { name: "worker/", size: 0, type: "directory" },
					},
					{
						header: { name: "worker/data.bin", size: 4 },
						body: Uint8Array.of(1, 2, 3, 4),
					},
				]),
			);
		}

		if (!request.body)
			return new Response("Request body is required.", { status: 400 });

		let count = 0;
		let totalBytes = 0;
		let bodyByteTotal = 0;
		let firstName = null;
		let lastName = null;

		try {
			if (mode === "buffered") {
				for (const entry of await unpackTar(request.body)) {
					const stats = await bodyStats(
						entry.data ?? new Uint8Array(0),
						"iterator",
					);
					if (firstName === null) firstName = entry.header.name;
					lastName = entry.header.name;
					count++;
					totalBytes += stats.totalBytes;
					bodyByteTotal += stats.bodyByteTotal;
				}
			} else {
				for await (const entry of request.body.pipeThrough(
					createTarDecoder(),
				)) {
					const stats = await bodyStats(entry.body, mode);
					if (firstName === null) firstName = entry.header.name;
					lastName = entry.header.name;
					count++;
					totalBytes += stats.totalBytes;
					bodyByteTotal += stats.bodyByteTotal;
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
