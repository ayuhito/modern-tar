import type { ParsedTarEntry, UnpackOptions } from "./types";

/**
 * Creates a transform stream that applies {@link UnpackOptions} to tar entries.
 *
 * @param options - The unpacking options to apply
 * @returns A TransformStream that processes {@link ParsedTarEntry} objects
 *
 * @example
 * ```typescript
 * import { createTarDecoder, createTarOptionsTransformer } from 'modern-tar';
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
			const stripCount = options.strip;
			if (stripCount && stripCount > 0) {
				const newName = stripPathComponents(header.name, stripCount);

				// If the entry's name is completely stripped, skip it.
				if (newName === null) {
					drainStream(entry.body);
					return;
				}

				let newLinkname = header.linkname;

				// If it's an absolute symlink/hardlink, strip its target path too.
				if (newLinkname?.startsWith("/")) {
					const strippedLinkTarget = stripPathComponents(
						newLinkname,
						stripCount,
					);

					// If the target is stripped, it should point to the new root '/'.
					newLinkname =
						strippedLinkTarget === null ? "/" : `/${strippedLinkTarget}`;
				}

				header = {
					...header,
					name:
						header.type === "directory" && !newName.endsWith("/")
							? `${newName}/`
							: newName,
					linkname: newLinkname,
				};
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
 * Strips the specified number of leading path components from a given path.
 */
function stripPathComponents(path: string, stripCount: number): string | null {
	const components = path.split("/").filter((c) => c.length > 0);
	if (stripCount >= components.length) {
		return null; // The path is fully stripped.
	}

	return components.slice(stripCount).join("/");
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
