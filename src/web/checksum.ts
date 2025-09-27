import { USTAR } from "./constants";
import { encoder, readOctal } from "./utils";

// ASCII code for a space character.
const CHECKSUM_SPACE = 32;

/**
 * Validates the checksum of a tar header block.
 */
export function validateChecksum(block: Uint8Array): boolean {
	const storedChecksum = readOctal(
		block,
		USTAR.checksum.offset,
		USTAR.checksum.size,
	);

	// Sum the bytes to get the checksum.
	let calculatedChecksum = 0;
	const checksumEnd = USTAR.checksum.offset + USTAR.checksum.size;

	for (let i = 0; i < block.length; i++) {
		// If the checksum field is included in the sum, it should be treated as if it were filled with ASCII spaces.
		if (i >= USTAR.checksum.offset && i < checksumEnd) {
			calculatedChecksum += CHECKSUM_SPACE; // Add space value for checksum field
		} else {
			calculatedChecksum += block[i];
		}
	}

	return storedChecksum === calculatedChecksum;
}

/**
 * Calculates and writes the checksum to a tar header block.
 */
export function writeChecksum(block: Uint8Array): void {
	// Fill the checksum field with spaces.
	const checksumEnd = USTAR.checksum.offset + USTAR.checksum.size;
	block.fill(CHECKSUM_SPACE, USTAR.checksum.offset, checksumEnd);

	// Sum the bytes to get the checksum.
	let checksum = 0;
	for (const byte of block) {
		checksum += byte;
	}

	// Format as a 6-digit octal string, NUL-terminated, and space-padded.
	const checksumString = `${checksum.toString(8).padStart(6, "0")}\0 `;
	const checksumBytes = encoder.encode(checksumString);

	// Write the checksum bytes into the block.
	block.set(checksumBytes, USTAR.checksum.offset);
}
