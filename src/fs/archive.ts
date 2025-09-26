import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createTarPacker, type TarPackController } from "../web/index";
import type { TarSource } from "./types";

async function addFileToPacker(
	controller: TarPackController,
	sourcePath: string,
	targetPath: string,
): Promise<void> {
	const stat = await fs.stat(sourcePath);
	const entryStream = controller.add({
		name: targetPath,
		size: stat.size,
		mode: stat.mode,
		mtime: stat.mtime,
		type: "file",
	});
	await pipeline(createReadStream(sourcePath), Writable.fromWeb(entryStream));
}

async function addDirectoryToPacker(
	controller: TarPackController,
	sourcePath: string,
	targetPathInArchive: string,
): Promise<void> {
	// Add the directory entry itself first.
	const sourceStat = await fs.stat(sourcePath);
	controller
		.add({
			name: `${targetPathInArchive}/`, // Directories in tar must end with a slash.
			type: "directory",
			mode: sourceStat.mode,
			mtime: sourceStat.mtime,
			size: 0,
		})
		.close();

	const dirents = await fs.readdir(sourcePath, { withFileTypes: true });

	// Process all directory contents sequentially.
	for (const dirent of dirents) {
		const fullSourcePath = path.join(sourcePath, dirent.name);
		const archiveEntryPath = path
			.join(targetPathInArchive, dirent.name)
			// Normalize to forward slashes for tar format.
			.replace(/\\/g, "/");

		if (dirent.isDirectory()) {
			await addDirectoryToPacker(controller, fullSourcePath, archiveEntryPath);
		} else if (dirent.isFile()) {
			await addFileToPacker(controller, fullSourcePath, archiveEntryPath);
		}
	}
}

/**
 * Packs multiple sources into a tar archive as a Node.js Readable stream from an
 * array of sources (files, directories, or raw content).
 *
 * @param sources - An array of {@link TarSource} objects describing what to include.
 * @returns A Node.js [`Readable`](https://nodejs.org/api/stream.html#class-streamreadable)
 * stream that outputs the tar archive bytes.
 *
 * @example
 * ```typescript
 * import { packTarSources, TarSource } from 'modern-tar/fs';
 *
 * const sources: TarSource[] = [
 * { type: 'file', source: './package.json', target: 'project/package.json' },
 * { type: 'directory', source: './src', target: 'project/src' },
 * { type: 'content', content: 'hello world', target: 'project/hello.txt' }
 * ];
 *
 * const archiveStream = packTarSources(sources);
 * await pipeline(archiveStream, createWriteStream('project.tar'));
 * ```
 */
export function packTarSources(sources: TarSource[]): Readable {
	const { readable, controller } = createTarPacker();

	// Run the packing process in the background for streams.
	(async () => {
		// TODO: Optimize with concurrency with a limit.
		for (const source of sources) {
			const targetPath = source.target.replace(/\\/g, "/");

			switch (source.type) {
				case "file":
					await addFileToPacker(controller, source.source, targetPath);
					break;

				case "directory":
					await addDirectoryToPacker(controller, source.source, targetPath);
					break;

				case "content": {
					// Handle different content types appropriately.
					const { content, mode } = source;

					if (content instanceof Blob) {
						const entryStream = controller.add({
							name: targetPath,
							size: content.size,
							mode,
							type: "file",
						});
						await content.stream().pipeTo(entryStream);
						break;
					}

					// This is inefficient for large streams as we have to buffer the entire content first,
					// to get the size. It's better to use Blob if possible.
					if (content instanceof ReadableStream) {
						const chunks: Buffer[] = [];

						// Async iterable over Readable stream is supported in older Node.
						for await (const chunk of Readable.fromWeb(content)) {
							chunks.push(chunk as Buffer);
						}

						const buffer = Buffer.concat(chunks);

						const entryStream = controller.add({
							name: targetPath,
							size: buffer.length,
							mode,
							type: "file",
						});

						const writer = entryStream.getWriter();
						await writer.write(buffer);
						await writer.close();

						break;
					}

					// All other more primitive types.
					let data: Uint8Array;
					if (content === null || content === undefined) {
						data = new Uint8Array(0);
					} else if (typeof content === "string") {
						data = Buffer.from(content);
					} else if (content instanceof ArrayBuffer) {
						data = new Uint8Array(content);
					} else {
						data = content;
					}

					const entryStream = controller.add({
						name: targetPath,
						size: data.length,
						mode,
						type: "file",
					});

					const writer = entryStream.getWriter();
					await writer.write(data);
					await writer.close();

					break;
				}
			}
		}
	})()
		.then(() => controller.finalize())
		.catch((err) => controller.error(err as Error));

	return Readable.fromWeb(readable);
}
