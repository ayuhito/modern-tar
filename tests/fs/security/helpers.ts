import { Readable } from "node:stream";
import type { unpackTar } from "../../../src/fs";
import { packTar, type TarEntry } from "../../../src/web";

const archive = async (entries: TarEntry[]) =>
	Readable.from([await packTar(entries)]);

export const archiveWithFile = (name: string) =>
	archive([
		{
			header: { name: "safe-file.txt", size: 14, type: "file" },
			body: "malicious data",
		},
		{
			header: { name, size: 14, type: "file" },
			body: "malicious data",
		},
	]);

export const archiveWithDirectory = (name: string) =>
	archive([
		{ header: { name: "safe-dir/", size: 0, type: "directory" } },
		{ header: { name, size: 0, type: "directory" } },
	]);

export const archiveWithHardlink = (name: string, linkname: string) =>
	archive([
		{
			header: { name: "safe-file.txt", size: 14, type: "file" },
			body: "malicious data",
		},
		{ header: { name, linkname, size: 0, type: "link" } },
	]);

export const archiveWithSymlink = (linkname: string) =>
	archive([
		{
			header: { name: "safe-file.txt", size: 12, type: "file" },
			body: "safe content",
		},
		{
			header: {
				name: "malicious-symlink",
				linkname,
				size: 0,
				type: "symlink",
			},
		},
	]);

export const writeChunk = (
	stream: ReturnType<typeof unpackTar>,
	chunk: Uint8Array,
) =>
	new Promise<void>((resolve, reject) => {
		stream.write(chunk, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
