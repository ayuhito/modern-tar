import { USTAR_CHECKSUM_OFFSET, USTAR_CHECKSUM_SIZE } from "./constants.js";
import { readOctal } from "./utils.js";

// ASCII code for a space character.
const CHECKSUM_SPACE = 32; // ' '
// ASCII code for the '0' character.
const ASCII_ZERO = 48; // '0'

// Validates the checksum of a tar header block.
export function validateChecksum(block: Uint8Array): boolean {
	const stored = readOctal(block, USTAR_CHECKSUM_OFFSET, USTAR_CHECKSUM_SIZE);

	let sum = 0;
	for (let i = 0; i < block.length; i++) {
		// If the byte is part of the checksum field, treat it as a space.
		if (
			i >= USTAR_CHECKSUM_OFFSET &&
			i < USTAR_CHECKSUM_OFFSET + USTAR_CHECKSUM_SIZE
		) {
			sum += CHECKSUM_SPACE;
		} else {
			sum += block[i];
		}
	}

	return stored === sum;
}

// Calculates and writes the checksum directly to the block.
export function writeChecksum(block: Uint8Array): void {
	// Fill with spaces for the calculation.
	block.fill(
		CHECKSUM_SPACE,
		USTAR_CHECKSUM_OFFSET,
		USTAR_CHECKSUM_OFFSET + USTAR_CHECKSUM_SIZE,
	);

	// Sum the entire block to get the checksum value.
	let checksum = 0;
	for (const byte of block) {
		checksum += byte;
	}

	// Write checksum as a 6-digit octal string directly into the block.
	// We work backwards from the last digit's position.
	for (let i = USTAR_CHECKSUM_OFFSET + 6 - 1; i >= USTAR_CHECKSUM_OFFSET; i--) {
		block[i] = (checksum & 7) + ASCII_ZERO; // (checksum % 8)
		checksum >>= 3; // Math.floor(checksum / 8)
	}

	// Add the required NUL and space terminators.
	block[USTAR_CHECKSUM_OFFSET + 6] = 0;
	block[USTAR_CHECKSUM_OFFSET + 7] = CHECKSUM_SPACE;
}
