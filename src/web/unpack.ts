import type { DecoderOptions } from "../tar/types";
import { createUnpacker } from "../tar/unpacker";
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
 * const decoder = createTarDecoder({ strict: true });
 * const entriesStream = tarStream.pipeThrough(decoder);
 *
 * for await (const entry of entriesStream) {
 *  console.log(`Entry: ${entry.header.name}`);
 *
 *  const shouldSkip = entry.header.name.endsWith('.md');
 *  if (shouldSkip) {
 *   // You MUST drain the body with cancel() to proceed to the next entry or read it fully,
 * 	 // otherwise the stream will stall.
 *   await entry.body.cancel();
 *   continue;
 *  }
 *
 *  const reader = entry.body.getReader();
 *  while (true) {
 * 	 const { done, value } = await reader.read();
 * 	 if (done) break;
 * 	 processChunk(value);
 *  }
 * }
 */
export function createTarDecoder(
	options: DecoderOptions = {},
): TransformStream<Uint8Array, ParsedTarEntry> {
	const unpacker = createUnpacker(options);

	let bodyController: ReadableStreamDefaultController<Uint8Array> | null = null;
	let pumping = false;

	// Pull from the unpacker and push to the appropriate streams.
	const pump = (
		controller: TransformStreamDefaultController<ParsedTarEntry>,
	) => {
		if (pumping) return;
		pumping = true;

		try {
			while (true) {
				if (unpacker.isEntryActive()) {
					if (bodyController) {
						const fed = unpacker.streamBody(
							// biome-ignore lint/style/noNonNullAssertion: Checked above.
							// biome-ignore lint/complexity/noCommaOperator: Smaller callback.
							(c) => (bodyController!.enqueue(c), true),
						);

						// Rxeturns 0 if no data is available OR if body is complete.
						if (fed === 0 && !unpacker.isBodyComplete()) break;
					} else if (!unpacker.skipEntry()) {
						break;
					}

					// Cleanup.
					if (unpacker.isBodyComplete()) {
						try {
							bodyController?.close();
						} catch {}
						bodyController = null;

						if (!unpacker.skipPadding()) break;
					}
				} else {
					// If entry is not active, try to read the next header.
					const header = unpacker.readHeader();
					if (header === null || header === undefined) break;

					// Start a new entry.
					controller.enqueue({
						header,
						body: new ReadableStream({
							start(c) {
								if (header.size === 0) c.close();
								else bodyController = c;
							},
							pull: () => pump(controller),
							cancel() {
								bodyController = null;
								pump(controller);
							},
						}),
					});
				}
			}
		} catch (error) {
			try {
				bodyController?.error(error);
			} catch {}
			bodyController = null;
			throw error;
		} finally {
			pumping = false;
		}
	};

	return new TransformStream<Uint8Array, ParsedTarEntry>(
		{
			transform(chunk, controller) {
				try {
					// Write incoming data to the unpacker.
					unpacker.write(chunk);
					pump(controller);
				} catch (error) {
					try {
						bodyController?.error(error);
					} catch {}
					throw error;
				}
			},

			flush(controller) {
				try {
					unpacker.end();
					pump(controller);
					unpacker.validateEOF();

					if (unpacker.isEntryActive() && !unpacker.isBodyComplete()) {
						try {
							bodyController?.close();
						} catch {}
					}
				} catch (error) {
					try {
						bodyController?.error(error);
					} catch {}
					throw error;
				}
			},
		},
		undefined,
		{ highWaterMark: 1 },
	);
}
