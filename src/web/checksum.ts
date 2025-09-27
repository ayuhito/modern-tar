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

	let unsignedSum = 0;

	// Sum the bytes BEFORE the checksum field.
	for (let i = 0; i < USTAR.checksum.offset; i++) {
		unsignedSum += block[i];
	}

	// Add the placeholder value for the checksum field itself.
	unsignedSum += CHECKSUM_SPACE * USTAR.checksum.size;

	// Sum the bytes AFTER the checksum field.
	for (
		let i = USTAR.checksum.offset + USTAR.checksum.size;
		i < block.length;
		i++
	) {
		unsignedSum += block[i];
	}

	return storedChecksum === unsignedSum;
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
