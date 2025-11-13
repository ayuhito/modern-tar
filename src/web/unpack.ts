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
 *  // Process entry.body stream as needed
 * }
 */
export function createTarDecoder(
	options: DecoderOptions = {},
): TransformStream<Uint8Array, ParsedTarEntry> {
	const unpacker = createUnpacker(options);

	let bodyController: ReadableStreamDefaultController<Uint8Array> | null = null;
	let pumping = false;
	let controllerTerminated = false;
	let eofReached = false;

	const abortAll = (
		reason: unknown,
		controller?: TransformStreamDefaultController<ParsedTarEntry>,
	) => {
		if (controllerTerminated) return;
		controllerTerminated = true;

		const error =
			reason instanceof Error ? reason : new Error(String(reason ?? ""));

		if (bodyController) {
			try {
				bodyController.error(error);
			} catch {}
			bodyController = null;
		}

		if (controller) {
			try {
				controller.error(error);
			} catch {}
		}
	};

	// Pull from the unpacker and push to the appropriate streams.
	const pump = (
		controller: TransformStreamDefaultController<ParsedTarEntry>,
		force = false,
	) => {
		if (pumping || controllerTerminated || eofReached) return;
		pumping = true;

		try {
			while (!controllerTerminated) {
				// Look for the next header.
				if (!bodyController) {
					// Respect backpressure on the main stream.
					if (!force && (controller.desiredSize ?? 0) < 0) break;

					const header = unpacker.readHeader();
					if (header === null) break; // Not enough data
					if (header === undefined) {
						eofReached = true;
						break;
					}

					const body = new ReadableStream<Uint8Array>({
						start: (c) => (bodyController = c),
						// When the consumer of this body stream pulls, it re-triggers the pump
						// to continue processing data for this entry.
						pull: () => pump(controller),
						// If the consumer cancels this body stream, clear the controller.
						cancel: () => {
							bodyController = null;
						},
					});

					// Enqueue the new entry object for the consumer.
					controller.enqueue({ header, body });

					// For zero-size entries (like directories), close the body stream
					// immediately and try to process the next header.
					if (header.size === 0) {
						// Immediately close zero-size entries and check for next header
						try {
							// biome-ignore lint/style/noNonNullAssertion: body processing state.
							bodyController!.close();
						} catch {}
						bodyController = null;
						if (!unpacker.skipPadding()) break;
						continue;
					}
				}

				// Stream the current entry body.
				if (unpacker.isBodyComplete()) {
					if (unpacker.skipPadding()) {
						try {
							// biome-ignore lint/style/noNonNullAssertion: body processing state.
							bodyController!.close();
						} catch {}
						bodyController = null;
						continue; // Done with entry, look for next header
					}
					break; // Not enough data for padding
				}

				// Respect backpressure.
				// biome-ignore lint/style/noNonNullAssertion: body processing state.
				if ((bodyController!.desiredSize ?? 1) <= 0) break;

				let shouldPause = false;
				const fed = unpacker.streamBody((chunk) => {
					if (!bodyController) return true; // Body cancelled
					try {
						// biome-ignore lint/style/noNonNullAssertion: body processing state.
						bodyController!.enqueue(chunk);

						// If the body stream's buffer is full, signal to pause the pump.
						// biome-ignore lint/style/noNonNullAssertion: body processing state.
						if ((bodyController!.desiredSize ?? 1) <= 0) shouldPause = true;
					} catch {
						return true; // Body errored or closed, discard
					}

					return true;
				});

				// No buffered data is available. Wait for the next chunk to resume pumping.
				if (fed === 0) break;

				// Check again if the body is now complete after streaming.
				if (unpacker.isBodyComplete()) {
					if (unpacker.skipPadding()) {
						try {
							// biome-ignore lint/style/noNonNullAssertion: body processing state.
							bodyController!.close();
						} catch {}
						bodyController = null;
						continue; // Loop to read the next header
					}
					break; // Not enough data for padding
				}

				if (shouldPause) break;
			}
		} catch (error) {
			abortAll(error, controller);
		} finally {
			pumping = false;
		}
	};

	return new TransformStream<Uint8Array, ParsedTarEntry>(
		{
			transform(chunk, controller) {
				try {
					// In strict mode, ensure EOF blocks are all zeroes.
					if (eofReached && options.strict && chunk.some((byte) => byte !== 0))
						throw new Error("Invalid EOF.");

					// Write incoming data to the unpacker.
					unpacker.write(chunk);
					pump(controller);
				} catch (error) {
					abortAll(error, controller);
					throw error;
				}
			},

			flush(controller) {
				try {
					unpacker.end();
					pump(controller, true); // Force pump for remaining data

					// If a bodyController still exists, the archive was truncated mid-file.
					if (bodyController) {
						if (options.strict) throw new Error("Tar archive is truncated.");

						// In non-strict mode, just close the partial stream.
						try {
							bodyController.close();
						} catch {}
						bodyController = null;
					}

					unpacker.validateEOF();

					if (!controllerTerminated) controller.terminate();
				} catch (error) {
					abortAll(error, controller);
					throw error;
				}
			},
		},
		undefined,
		{
			highWaterMark: 1,
		},
	);
}
