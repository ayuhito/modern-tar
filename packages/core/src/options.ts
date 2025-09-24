import type { ParsedTarEntry, UnpackOptions } from "./types";

/**
 * Creates a transform stream that applies {@link UnpackOptions} to tar entries.
 *
 * @param options - The unpacking options to apply
 * @returns A TransformStream that processes {@link ParsedTarEntry} objects
 *
 * @example
 * ```typescript
 * import { createTarDecoder, createTarOptionsTransformer } from '@modern-tar/core';
 *
 * const transformedStream = sourceStream
 *   .pipeThrough(createTarDecoder())
 *   .pipeThrough(createTarOptionsTransformer({
 *     strip: 1,
 *     filter: (header) => header.name.endsWith('.txt'),
 *     map: (header) => ({ ...header, mode: 0o644 })
 *   }));
 * ```
 */
export function createTarOptionsTransformer(
	options: UnpackOptions = {},
): TransformStream<ParsedTarEntry, ParsedTarEntry> {
	return new TransformStream<ParsedTarEntry, ParsedTarEntry>({
		async transform(entry, controller) {
			let header = entry.header;

			// Apply strip option
			if (options.strip !== undefined) {
				// Validate strip value
				if (options.strip < 0) {
					// Drain the body before throwing
					drainStream(entry.body);
					throw new Error(
						`Invalid strip value: ${options.strip}. Must be non-negative.`,
					);
				}

				if (options.strip > 0) {
					// Normalize path by removing empty components and leading/trailing slashes
					const normalizedPath = header.name
						.split("/")
						.filter((component: string) => component.length > 0);

					// Apply stripping
					const strippedComponents = normalizedPath.slice(options.strip);

					if (strippedComponents.length === 0) {
						// Drain and skip entries that become empty after stripping
						drainStream(entry.body);
						return;
					}

					const strippedName = strippedComponents.join("/");

					// Preserve directory indicator for directory entries
					if (header.type === "directory" && !strippedName.endsWith("/")) {
						header = { ...header, name: `${strippedName}/` };
					} else {
						header = { ...header, name: strippedName };
					}
				}
			}

			// Apply filter option
			if (options.filter && options.filter(header) === false) {
				// Drain and skip filtered entries
				drainStream(entry.body);
				return;
			}

			// Apply map option
			if (options.map) {
				header = options.map(header);
			}

			controller.enqueue({
				header,
				body: entry.body,
			});
		},
	});
}

/**
 * Drains the stream asynchronously without blocking the transform stream.
 */
function drainStream(stream: ReadableStream<Uint8Array>): void {
	// Don't await, just run in the background
	(async () => {
		const reader = stream.getReader();
		try {
			// eslint-disable-next-line no-constant-condition
			while (true) {
				const { done } = await reader.read();
				if (done) break;
			}
		} catch (error) {
			// Silently ignore drain errors to prevent unhandled rejections
			console.debug("Stream drain error (non-critical):", error);
		} finally {
			reader.releaseLock();
		}
	})();
}
