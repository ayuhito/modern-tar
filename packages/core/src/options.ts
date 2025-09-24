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
					await drainStream(entry.body);
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
						await drainStream(entry.body);
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
				await drainStream(entry.body);
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
 * Helper function to properly drain a ReadableStream to avoid hanging.
 * This is essential when skipping entries to ensure the stream doesn't stall.
 */
async function drainStream(stream: ReadableStream<Uint8Array>): Promise<void> {
	const reader = stream.getReader();
	try {
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const { done } = await reader.read();
			if (done) break;
		}
	} finally {
		reader.releaseLock();
	}
}
