import {
	USTAR_GNAME_SIZE,
	USTAR_MAX_SIZE,
	USTAR_MAX_UID_GID,
	USTAR_NAME_SIZE,
	USTAR_PREFIX_SIZE,
	USTAR_UNAME_SIZE,
} from "./constants.js";
import { createTarHeader } from "./header.js";
import type { TarHeader } from "./types.js";
import { decoder, encoder } from "./utils.js";

// Checks a tar header for fields that exceed USTAR limits and generates a PAX header entry if necessary.
export function generatePax(header: TarHeader): {
	paxHeader: Uint8Array;
	paxBody: Uint8Array;
} | null {
	const paxRecords: Record<string, string> = {};

	// Check max filename length.
	if (header.name.length > USTAR_NAME_SIZE) {
		const split = findUstarSplit(header.name);

		// If a valid USTAR split is not possible, we must use a PAX record.
		if (split === null) {
			paxRecords.path = header.name;
		}
	}

	// Check max linkname length.
	if (header.linkname && header.linkname.length > USTAR_NAME_SIZE) {
		paxRecords.linkpath = header.linkname;
	}

	// Check user/group names.
	if (header.uname && header.uname.length > USTAR_UNAME_SIZE) {
		paxRecords.uname = header.uname;
	}

	if (header.gname && header.gname.length > USTAR_GNAME_SIZE) {
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
export function findUstarSplit(
	path: string,
): { name: string; prefix: string } | null {
	// No split needed if the path already fits in the name field.
	if (path.length <= USTAR_NAME_SIZE) {
		return null;
	}

	// For the name part to fit, the slash must be at or after this index.
	const minSlashIndex = path.length - USTAR_NAME_SIZE - 1;

	// Find the rightmost slash that respects the prefix length limit (155).
	const slashIndex = path.lastIndexOf("/", USTAR_PREFIX_SIZE);

	// A valid split exists if we found a slash and it allows both parts to fit.
	if (slashIndex > 0 && slashIndex >= minSlashIndex) {
		return {
			prefix: path.slice(0, slashIndex),
			name: path.slice(slashIndex + 1),
		};
	}

	return null; // No valid split point found.
}
