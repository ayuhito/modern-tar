import { createTarDecoder, packTar, type TarEntry } from "modern-tar";
import {
	packTar as packTarFs,
	type TarSource,
	unpackTar as unpackTarFs,
} from "modern-tar/fs";

const entries: TarEntry[] = [
	{
		header: {
			name: "hello.txt",
			size: 5,
			mode: 0o644,
			uid: 0,
			gid: 0,
			mtime: new Date(0),
		},
		body: "hello",
	},
];

const archive: Promise<Uint8Array> = packTar(entries);
const decoder: TransformStream<
	Uint8Array,
	{ body: ReadableStream<Uint8Array> }
> = createTarDecoder();

const sources = [
	{ type: "content", target: "hello.txt", content: "hello" },
] satisfies readonly TarSource[];
const readable: NodeJS.ReadableStream = packTarFs(sources);
const writable: NodeJS.WritableStream = unpackTarFs("output");

void archive;
void decoder;
void readable;
void writable;
