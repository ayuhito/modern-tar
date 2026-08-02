import { Readable } from "node:stream";

export const archiveStream = (archive: Uint8Array): Readable =>
	Readable.from([archive]);
