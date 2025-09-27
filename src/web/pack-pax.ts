import { USTAR, USTAR_MAX_SIZE, USTAR_MAX_UID_GID } from "./constants";
import { createTarHeader } from "./pack";
import type { TarHeader } from "./types";
import { encoder } from "./utils";

// Checks a tar header for fields that exceed USTAR limits and generates a PAX header entry if necessary.
export function generatePax(header: TarHeader): {
	paxHeader: Uint8Array;
	paxBody: Uint8Array;
} | null {
	const paxRecords: Record<string, string> = {};

	// Check max filename length.
	if (header.name.length > USTAR.name.size) {
		const split = findUstarSplit(header.name);

		// If a valid USTAR split is not possible, we must use a PAX record.
		if (split === null) {
			paxRecords.path = header.name;
		}
	}

	// Check max linkname length.
	if (header.linkname && header.linkname.length > USTAR.name.size) {
		paxRecords.linkpath = header.linkname;
	}

	// Check user/group names.
	if (header.uname && header.uname.length > USTAR.uname.size) {
		paxRecords.uname = header.uname;
	}

	if (header.gname && header.gname.length > USTAR.gname.size) {
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
	const paxRecordsString = paxEntries
		.map(([key, value]) => {
			const record = `${key}=${value}\n`;
			// The PAX record length includes the length of the length-prefix itself.
			let length = record.length + 1; // +1 for the space
			const lengthOfLength = String(length).length;
			length += lengthOfLength;

			// Re-check if adding the length prefix's length changed its own number of digits.
			if (String(length).length !== lengthOfLength) {
				length++;
			}

			return `${length} ${record}`;
		})
		.join("");

	const paxBody = encoder.encode(paxRecordsString);

	const paxHeader = createTarHeader({
		name: `PaxHeader/${header.name}`.slice(0, 100),
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

// Attempts to split a long path into a USTAR-compatible name and prefix.
export function findUstarSplit(
	path: string,
): { name: string; prefix: string } | null {
	// No split needed if the path already fits in the name field.
	if (path.length <= USTAR.name.size) {
		return null;
	}

	// For the name part to fit, the slash must be at or after this index.
	const minSlashIndex = path.length - USTAR.name.size - 1;

	// Find the rightmost slash that respects the prefix length limit (155).
	const slashIndex = path.lastIndexOf("/", USTAR.prefix.size);

	// A valid split exists if we found a slash (index > 0) and it also
	// satisfies the minimum index required for the name part to fit.
	if (slashIndex > 0 && slashIndex >= minSlashIndex) {
		return {
			prefix: path.slice(0, slashIndex),
			name: path.slice(slashIndex + 1),
		};
	}

	return null; // No valid split point found.
}
