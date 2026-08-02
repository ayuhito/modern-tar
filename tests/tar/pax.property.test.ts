import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { decoder, encoder } from "../../src/tar/encoding";
import { parsePax } from "../../src/tar/header";
import { findUstarSplit, generatePax } from "../../src/tar/pax";

const unicodeText = gs.text({
	alphabet: "abc XYZ09-_=/\n\téñ测试файл🚀",
	maxSize: 300,
});

describe("PAX properties", () => {
	it("frames every generated record by its declared UTF-8 byte length", () =>
		hegel.test((tc) => {
			const path = tc.draw(unicodeText).replaceAll("/", "_").padEnd(101, "x");
			const comment = tc.draw(unicodeText);
			const custom = tc.draw(unicodeText);
			const generated = generatePax({
				name: path,
				size: 0,
				pax: { comment, custom },
			});
			expect(generated).not.toBeNull();
			if (!generated) throw new Error("Expected PAX data");

			let offset = 0;
			while (offset < generated.paxBody.length) {
				const space = generated.paxBody.indexOf(0x20, offset);
				expect(space).toBeGreaterThan(offset);
				const length = Number(
					decoder.decode(generated.paxBody.subarray(offset, space)),
				);
				const end = offset + length;
				expect(end).toBeLessThanOrEqual(generated.paxBody.length);
				expect(generated.paxBody[end - 1]).toBe(0x0a);
				expect(
					encoder.encode(
						decoder.decode(generated.paxBody.subarray(offset, end)),
					),
				).toHaveLength(length);
				offset = end;
			}
			expect(offset).toBe(generated.paxBody.length);
			expect(parsePax(generated.paxBody).pax).toEqual({
				path,
				comment,
				custom,
			});
		}));

	it("returns only byte-safe, lossless USTAR path splits", () =>
		hegel.test((tc) => {
			const parts = tc.draw(
				gs.arrays(gs.text({ alphabet: "abcé测试", minSize: 1, maxSize: 120 }), {
					minSize: 1,
					maxSize: 4,
				}),
			);
			const path = parts.join("/");
			const split = findUstarSplit(path);

			if (split) {
				expect(`${split.prefix}/${split.name}`).toBe(path);
				expect(encoder.encode(split.prefix).length).toBeLessThanOrEqual(155);
				expect(encoder.encode(split.name).length).toBeLessThanOrEqual(100);
			} else {
				const bytes = encoder.encode(path).length;
				expect(
					bytes <= 100 ||
						bytes > 256 ||
						!parts.slice(1).some((_, index) => {
							const prefix = parts.slice(0, index + 1).join("/");
							const name = parts.slice(index + 1).join("/");
							return (
								encoder.encode(prefix).length <= 155 &&
								encoder.encode(name).length <= 100
							);
						}),
				).toBe(true);
			}
		}));
});
