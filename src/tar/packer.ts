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

	return {
		add(header: TarHeader): void {
			if (finalized) {
				const error = new Error("No new tar entries after finalize.");
				onError(error);
				throw error;
			}

			if (currentHeader !== null) {
				const error = new Error(
					"Previous entry must be completed before adding a new one",
				);
				onError(error);
				throw error;
			}

			try {
				// Entries without a data body have size 0.
				const isBodyless =
					header.type === "directory" ||
					header.type === "symlink" ||
					header.type === "link";
				const size = isBodyless ? 0 : (header.size ?? 0);

				const headerBlocks = getHeaderBlocks({ ...header, size });
				for (const block of headerBlocks) {
					onData(block);
				}

				currentHeader = { ...header, size };
				bytesWritten = 0;
			} catch (error) {
				onError(error as Error);
			}
		},

		write(chunk: Uint8Array): void {
			if (!currentHeader) {
				const error = new Error("No active tar entry.");
				onError(error);
				throw error;
			}

			if (finalized) {
				const error = new Error("Cannot write data after finalize.");
				onError(error);
				throw error;
			}

			const newTotal = bytesWritten + chunk.length;
			if (newTotal > currentHeader.size) {
				const error = new Error(
					`"${currentHeader.name}" exceeds given size of ${currentHeader.size} bytes.`,
				);
				onError(error);
				throw error;
			}

			try {
				bytesWritten = newTotal;
				onData(chunk);
			} catch (error) {
				onError(error as Error);
			}
		},

		endEntry(): void {
			if (!currentHeader) {
				const error = new Error("No active entry to end.");
				onError(error);
				throw error;
			}

			if (finalized) {
				const error = new Error("Cannot end entry after finalize.");
				onError(error);
				throw error;
			}

			try {
				if (bytesWritten !== currentHeader.size) {
					const error = new Error(`Size mismatch for "${currentHeader.name}".`);
					onError(error);
					throw error;
				}

				// Add padding to reach 512-byte boundary.
				const paddingSize = -currentHeader.size & BLOCK_SIZE_MASK;
				if (paddingSize > 0) {
					const paddingBuffer = new Uint8Array(paddingSize);
					onData(paddingBuffer);
				}

				// Reset state.
				currentHeader = null;
				bytesWritten = 0;
			} catch (error) {
				onError(error as Error);
				throw error;
			}
		},

		finalize(): void {
			if (finalized) {
				const error = new Error("Archive has already been finalized");
				onError(error);
				throw error;
			}

			if (currentHeader !== null) {
				const error = new Error(
					"Cannot finalize while an entry is still active",
				);
				onError(error);
				throw error;
			}

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
