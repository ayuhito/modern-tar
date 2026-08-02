import {
	USTAR_GNAME_SIZE,
	USTAR_MAX_SIZE,
	USTAR_MAX_UID_GID,
	USTAR_NAME_SIZE,
	USTAR_PREFIX_SIZE,
	USTAR_UNAME_SIZE,
} from "./constants";
import { decoder, encoder } from "./encoding";
import { createTarHeader } from "./header";
import type { TarHeader } from "./types";

const USTAR_SPLIT_MAX_SIZE = USTAR_PREFIX_SIZE + USTAR_NAME_SIZE + 1;
// biome-ignore lint/suspicious/noControlCharactersInRegex: The full ASCII byte range is intentional.
const NON_ASCII = /[^\x00-\x7f]/;

function isUtf8TooLong(value: string, limit: number): boolean {
	// UTF-16 length gives cheap lower and upper bounds for UTF-8 bytes.
	if (value.length * 3 <= limit) return false;
	if (value.length > limit) return true;

	// Medium-length ASCII is exact; measure Unicode strings.
	if (!NON_ASCII.test(value)) return false;
	return encoder.encode(value).length > limit;
}

// Checks a tar header for fields that exceed USTAR limits and generates a PAX header entry if necessary.
export function generatePax(header: TarHeader): {
	paxHeader: Uint8Array;
	paxBody: Uint8Array;
} | null {
	const paxRecords: Record<string, string> = {};

	// Check max filename length (using byte length for multi-byte safety).
	if (isUtf8TooLong(header.name, USTAR_NAME_SIZE)) {
		const split = findUstarSplit(header.name);

		// If a valid USTAR split is not possible, we must use a PAX record.
		if (split === null) {
			paxRecords.path = header.name;
		}
	}

	// Check max linkname length.
	if (header.linkname && isUtf8TooLong(header.linkname, USTAR_NAME_SIZE)) {
		paxRecords.linkpath = header.linkname;
	}

	// Check user/group names.
	if (header.uname && isUtf8TooLong(header.uname, USTAR_UNAME_SIZE)) {
		paxRecords.uname = header.uname;
	}

	if (header.gname && isUtf8TooLong(header.gname, USTAR_GNAME_SIZE)) {
		paxRecords.gname = header.gname;
	}

	// Check UID/GID values.
	if (header.uid != null && header.uid > USTAR_MAX_UID_GID) {
		paxRecords.uid = String(header.uid);
	}

	if (header.gid != null && header.gid > USTAR_MAX_UID_GID) {
		paxRecords.gid = String(header.gid);
	}

	// Check file size.
	if (header.size != null && header.size > USTAR_MAX_SIZE) {
		paxRecords.size = String(header.size);
	}

	// Add any user-provided PAX attributes.
	if (header.pax) {
		Object.assign(paxRecords, header.pax);
	}

	const paxEntries = Object.entries(paxRecords);

	// If no PAX records were generated, we're done.
	if (paxEntries.length === 0) {
		return null;
	}

	// Else, format PAX records into a string.
	const paxBody = encoder.encode(
		paxEntries
			.map(([key, value]) => {
				const record = `${key}=${value}\n`;

				// Get byte length to handle multi byte Unicode characters correctly.
				const partLength = encoder.encode(record).length + 1; // +1 for the space
				let totalLength = partLength + String(partLength).length;

				// Calculate again to handle the new length increase.
				totalLength = partLength + String(totalLength).length;

				return `${totalLength} ${record}`;
			})
			.join(""),
	);

	const paxHeader = createTarHeader({
		// We decode like this specifically to ensure no multi-byte chars sneak in
		// and exceed 100 bytes.
		name: decoder.decode(
			encoder.encode(`PaxHeader/${header.name}`).slice(0, 100),
		),
		size: paxBody.length,
		type: "pax-header",
		mode: 0o644,
		mtime: header.mtime,
		uname: header.uname,
		gname: header.gname,
		uid: header.uid,
		gid: header.gid,
	});

	return { paxHeader, paxBody };
}

// Tries to split a long path into a USTAR compatible name and prefix.
// Uses byte lengths to correctly handle multi-byte UTF-8 characters.
export function findUstarSplit(
	path: string,
): { name: string; prefix: string } | null {
	// A USTAR split only applies to UTF-8 paths that overflow name[100] but
	// still fit within prefix[155] + "/" + name[100].
	//
	// Returning null here signals to the caller that a USTAR split is not possible
	// and a PAX record should be used instead.
	if (
		!isUtf8TooLong(path, USTAR_NAME_SIZE) ||
		isUtf8TooLong(path, USTAR_SPLIT_MAX_SIZE)
	)
		return null;

	// Find the rightmost '/' that allows both parts to fit within byte limits.
	for (let i = path.length - 1; i > 0; i--) {
		if (path[i] !== "/") continue;

		const prefix = path.slice(0, i);
		const name = path.slice(i + 1);

		if (
			!isUtf8TooLong(prefix, USTAR_PREFIX_SIZE) &&
			!isUtf8TooLong(name, USTAR_NAME_SIZE)
		)
			return { prefix, name };
	}

	return null; // No valid split point found.
}
