import type { DecoderOptions } from "../tar/types";
import { createUnpacker } from "../tar/unpacker";
import type { ParsedTarEntry } from "./types";

const BUFFER_LIMIT = 1024 * 1024;
const RESUME_LIMIT = BUFFER_LIMIT / 2;

/**
 * Create a readable/writable stream pair that parses tar bytes into entries.
 *
 * @param options - Optional configuration for the decoder using {@link DecoderOptions}.
 * @returns A readable/writable pair that converts tar archive bytes to {@link ParsedTarEntry} objects.
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
): ReadableWritablePair<ParsedTarEntry, Uint8Array> {
	const unpacker = createUnpacker(options);
	const strict = options.strict ?? false;

	// Drives the outer stream of ParsedTarEntry objects.
	let controller: ReadableStreamDefaultController<ParsedTarEntry> | null = null;
	// Points at the currently active entry body stream.
	let bodyController: ReadableStreamDefaultController<Uint8Array> | null = null;
	let pumping = false;
	let blocked = false;
	let resume: (() => void) | null = null;
	// We can parse the two zero EOF blocks before the writable side actually closes.
	// Keeping these states separate lets strict mode reject non-zero trailing bytes.
	let eofReached = false;
	let sourceEnded = false;
	let closed = false;
	const unblock = () => {
		resume?.();
		resume = null;
	};

	const closeBody = () => {
		try {
			bodyController?.close();
		} catch {}
		bodyController = null;
	};

	const fail = (reason: unknown) => {
		if (closed) return;
		closed = true;

		try {
			bodyController?.error(reason);
		} catch {}
		bodyController = null;

		try {
			// biome-ignore lint/style/noNonNullAssertion: Closed flg checks.
			controller!.error(reason);
		} catch {}
		controller = null;
		unblock();
	};

	const finish = () => {
		if (closed) return;
		closed = true;
		closeBody();

		try {
			// biome-ignore lint/style/noNonNullAssertion: Closed flag checks.
			controller!.close();
		} catch {}
		controller = null;
		unblock();
	};

	const truncateOrFinish = () => {
		if (strict) throw new Error("Tar archive is truncated.");
		finish();
	};

	const pump = () => {
		if (pumping || closed || !controller) return;
		blocked = false;
		pumping = true;

		try {
			while (true) {
				if (eofReached) {
					if (sourceEnded) {
						unpacker.validateEOF();
						finish();
					}
					break;
				}

				if (unpacker.isEntryActive()) {
					if (sourceEnded && !unpacker.canFinish()) {
						truncateOrFinish();
						break;
					}

					if (bodyController) {
						if ((bodyController.desiredSize ?? 1) <= 0) {
							blocked = true;
							break;
						}

						const fed = unpacker.streamBody(
							(c) =>
								(
									// biome-ignore lint/style/noNonNullAssertion lint/complexity/noCommaOperator: Checked above and smaller bundle size.
									bodyController!.enqueue(c),
									// biome-ignore lint/style/noNonNullAssertion: Checked above.
									(bodyController!.desiredSize ?? 1) > 0
								),
						);

						if (fed === 0 && !unpacker.isBodyComplete()) {
							if (sourceEnded) truncateOrFinish();
							break;
						}
					} else if (!unpacker.skipEntry()) {
						if (sourceEnded) truncateOrFinish();
						break;
					}

					// Cleanup.
					if (unpacker.isBodyComplete()) {
						closeBody();

						if (!unpacker.skipPadding()) {
							if (sourceEnded) truncateOrFinish();
							break;
						}
					}
				} else {
					if ((controller.desiredSize ?? 0) < 0) {
						blocked = true;
						break;
					}

					// If entry is not active, try to read the next header.
					const header = unpacker.readHeader();
					if (header === null) {
						if (sourceEnded) finish();
						break;
					}

					if (header === undefined) {
						if (sourceEnded) {
							unpacker.validateEOF();
							finish();
							break;
						}

						eofReached = true;
						break;
					}

					// Start a new entry.
					controller.enqueue({
						header,
						body: new ReadableStream({
							start(c) {
								if (header.size === 0) c.close();
								else bodyController = c;
							},
							pull: pump,
							cancel() {
								bodyController = null;
								pump();
							},
						}),
					});
				}
			}
		} catch (error) {
			fail(error);
			throw error;
		} finally {
			pumping = false;
		}

		if (resume && (!blocked || unpacker.available() < RESUME_LIMIT)) unblock();
	};

	return {
		readable: new ReadableStream<ParsedTarEntry>(
			{
				start(c) {
					controller = c;
				},
				pull: pump,
				cancel(reason) {
					unpacker.end();
					if (reason !== undefined) fail(reason);
					else finish();
				},
			},
			{
				// Memory management is managed by the unpacker, but HWM 2 does perform a bit better when working
				// with many small entries.
				highWaterMark: 2,
			},
		),

		writable: new WritableStream<Uint8Array>({
			write(chunk, controller) {
				try {
					if (eofReached && strict && chunk.some((byte) => byte !== 0))
						throw new Error("Invalid EOF.");

					unpacker.write(chunk);
					pump();
					if (blocked && unpacker.available() >= BUFFER_LIMIT) {
						controller.signal.onabort = unblock;
						return new Promise<void>((resolve) => (resume = resolve));
					}
				} catch (error) {
					fail(error);
					throw error;
				}
			},

			close() {
				try {
					sourceEnded = true;
					unpacker.end();
					pump();
				} catch (error) {
					fail(error);
					throw error;
				}
			},

			abort(reason) {
				fail(reason);
			},
		}),
	};
}
