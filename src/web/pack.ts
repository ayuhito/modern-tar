import { createTarPacker as createPacker } from "../tar/packer";
import type { TarHeader } from "../tar/types";

/**
 * Controls a streaming tar packing process.
 *
 * Provides methods to add entries to a tar archive and finalize the stream.
 * This is the advanced API for streaming tar creation, allowing you to dynamically
 * add entries and write their content as a [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream).
 */
export interface TarPackController {
	/**
	 * Add an entry to the tar archive.
	 *
	 * After adding the entry, you must write exactly `header.size` bytes of data
	 * to the returned [`WritableStream`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStream)
	 * and then close it. For entries that do not have a body (e.g., directories),
	 * the size property should be set to 0 and the stream should be closed immediately.
	 *
	 * @param header - The tar header for the entry. The `size` property must be accurate
	 * @returns A [`WritableStream`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStream) for writing the entry's body data
	 *
	 * @example
	 * ```typescript
	 * // Add a text file
	 * const fileStream = controller.add({
	 *   name: "file.txt",
	 *   size: 11,
	 *   type: "file"
	 * });
	 *
	 * const writer = fileStream.getWriter();
	 * await writer.write(new TextEncoder().encode("hello world"));
	 * await writer.close();
	 *
	 * // Add a directory
	 * const dirStream = controller.add({
	 *   name: "folder/",
	 *   type: "directory",
	 *   size: 0
	 * });
	 * await dirStream.close(); // Directories have no content
	 * ```
	 */
	add(header: TarHeader): WritableStream<Uint8Array>;

	/**
	 * Finalize the archive.
	 *
	 * Must be called after all entries have been added.
	 * This writes the end-of-archive marker and closes the readable stream.
	 */
	finalize(): void;

	/**
	 * Abort the packing process with an error.
	 *
	 * @param err - The error that caused the abort
	 */
	error(err: unknown): void;
}

/**
 * Create a streaming tar packer.
 *
 * Provides a controller-based API for creating tar archives, suitable for scenarios where entries are
 * generated dynamically. The returned [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)
 * outputs tar archive bytes as entries are added.
 *
 * @returns Object containing the readable stream and controller
 * @returns readable - [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) that outputs the tar archive bytes
 * @returns controller - {@link TarPackController} for adding entries and finalizing
 *
 * @example
 * ```typescript
 * import { createTarPacker } from 'modern-tar';
 *
 * const { readable, controller } = createTarPacker();
 *
 * // Add entries dynamically
 * const fileStream = controller.add({
 *   name: "dynamic.txt",
 *   size: 5,
 *   type: "file"
 * });
 *
 * const writer = fileStream.getWriter();
 * await writer.write(new TextEncoder().encode("hello"));
 * await writer.close();
 *
 * // Add multiple entries
 * const jsonStream = controller.add({
 *   name: "data.json",
 *   size: 13,
 *   type: "file"
 * });
 * const jsonWriter = jsonStream.getWriter();
 * await jsonWriter.write(new TextEncoder().encode('{"test":true}'));
 * await jsonWriter.close();
 *
 * // Finalize the archive
 * controller.finalize();
 *
 * // Use the readable stream
 * const response = new Response(readable);
 * const buffer = await response.arrayBuffer();
 * ```
 */
export function createTarPacker(): {
	readable: ReadableStream<Uint8Array<ArrayBuffer>>;
	controller: TarPackController;
} {
	let streamController: ReadableStreamController<Uint8Array<ArrayBuffer>>;
	let packer: ReturnType<typeof createPacker>;
	let bodyController: WritableStreamDefaultController | null = null;
	let resume: (() => void) | null = null;
	let drain: Promise<void> | null = null;
	let stopped = false;
	let stopReason: unknown;

	const unblock = () => {
		resume?.();
		resume = null;
		drain = null;
	};

	const stop = (reason: unknown) => {
		if (stopped) return;
		stopped = true;
		stopReason = reason;

		bodyController?.error(reason);
		bodyController = null;

		streamController.error(reason);
		unblock();
	};
	const abortBody = (reason = AbortSignal.abort().reason) => {
		bodyController = null;
		stop(reason);
	};

	const checkStopped = () => {
		if (stopped) throw stopReason;
	};

	const emit = (operation: () => void): void | Promise<void> => {
		checkStopped();
		try {
			operation();
		} catch (error) {
			stop(error);
			throw error;
		}

		const pending = drain;
		if (!pending) return;

		// Only wait when abort() can release backpressure.
		const signal = bodyController?.signal;
		if (!signal) return;
		if (signal.aborted) abortBody(signal.reason);
		else signal.onabort = () => abortBody(signal.reason);

		return pending.then(checkStopped);
	};

	const source: UnderlyingDefaultSource<Uint8Array<ArrayBuffer>> = {
		start(controller) {
			streamController = controller;
			packer = createPacker((chunk) => {
				// Native BufferSource consumers require fixed ArrayBuffer views.
				const buffer = chunk.buffer;
				controller.enqueue(
					buffer instanceof ArrayBuffer && !Reflect.get(buffer, "resizable")
						? (chunk as Uint8Array<ArrayBuffer>)
						: new Uint8Array(chunk),
				);

				if ((controller.desiredSize ?? 1) <= 0) {
					drain ||= new Promise<void>((resolve) => {
						resume = resolve;
					});
				}
			});
		},
		pull: unblock,
		cancel(reason = AbortSignal.abort().reason) {
			stop(reason);
		},
	};
	const readable = new ReadableStream<Uint8Array<ArrayBuffer>>(
		source,
		new ByteLengthQueuingStrategy({ highWaterMark: 8 * 1024 * 1024 }),
	);

	const packController: TarPackController = {
		add(header: TarHeader): WritableStream<Uint8Array> {
			try {
				checkStopped();
				if (bodyController)
					throw new Error(
						"Previous entry must be completed before adding a new one",
					);
				packer.add(header);
			} catch (error) {
				stop(error);
				throw error;
			}

			return new WritableStream<Uint8Array>({
				start(controller) {
					bodyController = controller;
				},

				write(chunk) {
					return emit(() => packer.write(chunk));
				},

				close() {
					const result = emit(() => packer.endEntry());
					if (!result) {
						bodyController = null;
						return;
					}

					return result.then(() => {
						bodyController = null;
					});
				},

				abort: abortBody,
			});
		},

		finalize() {
			try {
				checkStopped();
				if (bodyController)
					throw new Error("Cannot finalize while an entry is still active");
				packer.finalize();
				streamController.close();
			} catch (error) {
				stop(error);
				throw error;
			}
		},

		error(err: unknown) {
			stop(err);
		},
	};

	return { readable, controller: packController };
}
