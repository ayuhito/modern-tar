import { isBodyless } from "./body";
import { BLOCK_SIZE, BLOCK_SIZE_MASK } from "./constants";
import { getHeaderBlocks } from "./header";
import type { TarHeader } from "./types";

const EOF_BUFFER = new Uint8Array(BLOCK_SIZE * 2); // Two zero blocks for EOF

export function createTarPacker(
	onData: (chunk: Uint8Array) => void,
	onError: (error: Error) => void,
	onFinalize?: () => void,
) {
	let currentHeader: TarHeader | null = null;
	let bytesWritten = 0;
	let finalized = false;

	const fail = (message: string): never => {
		const error = new Error(message);
		onError(error);
		throw error;
	};

	return {
		add(header: TarHeader): void {
			if (finalized) fail("No new tar entries after finalize.");
			if (currentHeader !== null)
				fail("Previous entry must be completed before adding a new one");

			// Entries without a data body have size 0.
			const size = isBodyless(header) ? 0 : header.size;

			if (!Number.isSafeInteger(size) || size < 0)
				fail("Invalid tar entry size.");

			try {
				const headerBlocks = getHeaderBlocks({ ...header, size });
				for (const block of headerBlocks) onData(block);

				currentHeader = { ...header, size };
				bytesWritten = 0;
			} catch (error) {
				onError(error as Error);
			}
		},

		write(chunk: Uint8Array): void {
			if (!currentHeader) fail("No active tar entry.");
			if (finalized) fail("Cannot write data after finalize.");

			const newTotal = bytesWritten + chunk.length;
			// biome-ignore lint/style/noNonNullAssertion: Checked above.
			if (newTotal > currentHeader!.size)
				fail(
					// biome-ignore lint/style/noNonNullAssertion: Checked above.
					`"${currentHeader!.name}" exceeds given size of ${currentHeader!.size} bytes.`,
				);

			try {
				bytesWritten = newTotal;
				onData(chunk);
			} catch (error) {
				onError(error as Error);
			}
		},

		endEntry(): void {
			if (!currentHeader) fail("No active entry to end.");
			if (finalized) fail("Cannot end entry after finalize.");

			try {
				// biome-ignore lint/style/noNonNullAssertion: Checked above.
				if (bytesWritten !== currentHeader!.size)
					// biome-ignore lint/style/noNonNullAssertion: Checked above.
					fail(`Size mismatch for "${currentHeader!.name}".`);

				// Add padding to reach 512-byte boundary.
				// biome-ignore lint/style/noNonNullAssertion: Checked above.
				const paddingSize = -currentHeader!.size & BLOCK_SIZE_MASK;
				// Write padding buffer if needed.
				if (paddingSize > 0) onData(new Uint8Array(paddingSize));

				// Reset state.
				currentHeader = null;
				bytesWritten = 0;
			} catch (error) {
				onError(error as Error);
				throw error;
			}
		},

		finalize(): void {
			if (finalized) fail("Archive has already been finalized");
			if (currentHeader !== null)
				fail("Cannot finalize while an entry is still active");

			try {
				// Write two 512-byte zero blocks to mark end of archive
				onData(EOF_BUFFER);
				finalized = true;

				if (onFinalize) onFinalize();
			} catch (error) {
				onError(error as Error);
			}
		},
	};
}
