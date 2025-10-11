import type { DecoderOptions } from "../tar/types";
import { createTarUnpacker } from "../tar/unpacker";
import type { ParsedTarEntry } from "./types";

/**
 * Create a transform stream that parses tar bytes into entries.
 *
 * @param options - Optional configuration for the decoder using {@link DecoderOptions}.
 * @returns `TransformStream` that converts tar archive bytes to {@link ParsedTarEntry} objects.
 * @example
 * ```typescript
 * import { createTarDecoder } from 'modern-tar';
 *
 * const decoder = createTarDecoder();
 * const entriesStream = tarStream.pipeThrough(decoder);
 *
 * for await (const entry of entriesStream) {
 *  console.log(`Entry: ${entry.header.name}`);
 *  // Process entry.body stream as needed
 * }
 */
export function createTarDecoder(
	options: DecoderOptions = {},
): TransformStream<Uint8Array, ParsedTarEntry> {
	let unpacker: ReturnType<typeof createTarUnpacker>;
	let streamController: ReadableStreamDefaultController<Uint8Array> | null =
		null;

	return new TransformStream({
		start(controller) {
			// Helper to safely close or error the current entry's body stream.
			const closeCurrentBody = (err?: Error) => {
				if (streamController) {
					try {
						if (err) {
							streamController.error(err);
						} else {
							streamController.close();
						}
					} catch {
						// Suppress errors if the consumer has already cancelled the stream.
					}
					streamController = null;
				}
			};

			unpacker = createTarUnpacker(
				{
					onHeader(header) {
						// Ensure any previous body stream is closed.
						closeCurrentBody();

						const body = new ReadableStream<Uint8Array>({
							// biome-ignore lint/suspicious/noAssignInExpressions: Intentional assignment.
							start: (c) => (streamController = c),
						});

						controller.enqueue({ header, body });

						if (header.size === 0) {
							closeCurrentBody();
						}
					},

					onData(chunk) {
						try {
							streamController?.enqueue(chunk);
						} catch {}
					},

					onEndEntry: () => closeCurrentBody(),

					onError(error) {
						closeCurrentBody(error);
						controller.error(error);
					},
				},
				options,
			);
		},

		transform(chunk, controller) {
			try {
				unpacker.write(chunk);
			} catch (e) {
				controller.error(e);
			}
		},

		flush(controller) {
			try {
				unpacker.end();
			} catch (e) {
				controller.error(e);
			}
		},
	});
}
