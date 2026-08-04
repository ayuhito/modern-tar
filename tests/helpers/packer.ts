import type { TarPackController } from "../../src/web";

const CHUNK_SIZE = 1024 * 1024;
const OUTPUT_BUFFER_CHUNKS = 8;

/**
 * Preloads seven 1 MiB body chunks, then starts the eighth write that crosses
 * the 8 MiB output limit after the packer's 512-byte TAR header.
 *
 * The returned write stays pending until output demand resumes or the writer
 * is aborted.
 */
export async function blockPackerOutput(controller: TarPackController) {
	const writer = controller
		.add({ name: "file", size: OUTPUT_BUFFER_CHUNKS * CHUNK_SIZE })
		.getWriter();
	const chunk = new Uint8Array(CHUNK_SIZE);
	for (let i = 0; i < OUTPUT_BUFFER_CHUNKS - 1; i++) {
		await writer.write(chunk);
	}

	return { chunk, writer, write: writer.write(chunk) };
}
