import { DIRECTORY, EMPTY, LINK, SYMLINK } from "./constants";
import { encoder } from "./encoding";
import type { TarEntryData, TarHeader } from "./types";

export const isBodyless = (header: TarHeader) =>
	header.type === DIRECTORY ||
	header.type === SYMLINK ||
	header.type === LINK ||
	header.type === "character-device" ||
	header.type === "block-device" ||
	header.type === "fifo";

export async function normalizeBody(body: TarEntryData): Promise<Uint8Array> {
	if (body === null || body === undefined) return EMPTY;
	if (body instanceof Uint8Array) return body;
	if (typeof body === "string") return encoder.encode(body);
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());

	throw new TypeError("Unsupported content type for entry body.");
}
