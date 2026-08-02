import { Readable } from "node:stream";
import type { unpackTar } from "../../../src/fs";
import { packTar, type TarEntry } from "../../../src/web";

const archive = async (entries: TarEntry[]) =>
	Readable.from([await packTar(entries)]);

export const createTarWithMaliciousFile = (name: string) =>
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

export const createTarWithMaliciousDirectory = (name: string) =>
	archive([
		{ header: { name: "safe-dir/", size: 0, type: "directory" } },
		{ header: { name, size: 0, type: "directory" } },
	]);

export const createTarWithMaliciousHardlink = (
	name: string,
	linkname: string,
) =>
	archive([
		{
			header: { name: "safe-file.txt", size: 14, type: "file" },
			body: "malicious data",
		},
		{ header: { name, linkname, size: 0, type: "link" } },
	]);

export const createTarWithSymlink = (linkname: string) =>
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
