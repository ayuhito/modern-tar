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
	// Used to return a promise when starved for data to avoid infinite pull() loops.
	let pullResolve: (() => void) | null = null;
	// biome-ignore lint/complexity/noCommaOperator: Smaller bundle.
	const resolve = () => (pullResolve?.(), (pullResolve = null));

	// Pull from the unpacker and push to the appropriate streams.
	const pump = (
		controller: TransformStreamDefaultController<ParsedTarEntry>,
		chunk?: Uint8Array,
		ended?: boolean,
	) => {
		if (pumping) return chunk && unpacker.write(chunk);
		pumping = true;

		try {
			if (chunk) unpacker.write(chunk);
			if (ended) unpacker.end();
			// Signal that state has changed (new data or EOF) to wake up any pending pull().
			resolve();

			while (true) {
				if (unpacker.isEntryActive()) {
					if (bodyController) {
						const fed = unpacker.streamBody(
							// biome-ignore lint/style/noNonNullAssertion: Checked above.
							// biome-ignore lint/complexity/noCommaOperator: Smaller callback.
							(c) => (bodyController!.enqueue(c), true),
						);
						if (fed > 0) resolve();
						if (fed === 0 && !unpacker.isBodyComplete()) {
							if (ended) {
								try {
									// biome-ignore lint/style/noNonNullAssertion: Required for close.
									bodyController!.close();
								} catch {}
								// biome-ignore lint/complexity/noCommaOperator: Smaller bundle.
								(bodyController = null), resolve();
							}
							break;
						}
					} else if (!unpacker.skipEntry()) break;

					// Cleanup.
					if (unpacker.isBodyComplete()) {
						try {
							bodyController?.close();
						} catch {}

						// biome-ignore lint/complexity/noCommaOperator: Smaller bundle.
						(bodyController = null), resolve();
						if (!unpacker.skipPadding()) break;
					}
				} else {
					// If entry is not active, try to read the next header.
					const header = unpacker.readHeader();
					if (!header) break;

					// Start a new entry.
					controller.enqueue({
						header,
						body: new ReadableStream({
							start: (c) => (header.size ? (bodyController = c) : c.close()),
							pull: () => {
								pump(controller);
								if (bodyController && !unpacker.isBodyComplete())
									return new Promise<void>((r) => (pullResolve = r));
							},
							cancel: () =>
								(
									// biome-ignore lint/complexity/noCommaOperator: Smaller bundle.
									(bodyController = null), resolve(), pump(controller)
								),
						}),
					});
				}
			}

			// If we've ended and processed all entries, validate that there are no trailing bytes.
			if (ended) unpacker.validateEOF();
		} catch (error) {
			try {
				bodyController?.error(error);
			} catch {}
			// biome-ignore lint/complexity/noCommaOperator: Smaller bundle.
			(bodyController = null), resolve();
			throw error;
		} finally {
			pumping = false;
		}
	};

	return new TransformStream(
		{
			transform: (chunk, controller) => pump(controller, chunk),
			flush: (controller) => pump(controller, undefined, true),
		},
		undefined,
		{
			// Keep one extra slot to avoid backpressure deadlocks when the unpacker needs more data to proceed.
			highWaterMark: 2,
		},
	);
}
