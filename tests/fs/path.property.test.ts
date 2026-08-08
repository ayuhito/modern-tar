import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { normalizeHeaderName } from "../../src/fs/path";

const segment = gs.text({
	alphabet:
		"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-$@éñ测试файл",
	minSize: 1,
	maxSize: 20,
});

const prefixes = ["", "/", "\\", "///", "\\".repeat(3), "/\\"];
const separators = ["/", "\\", "//", "\\\\", "/\\"];

const portablePath = gs
	.record({
		leading: gs.sampledFrom(prefixes),
		segments: gs.arrays(segment, { minSize: 1, maxSize: 8 }),
		separator: gs.sampledFrom(separators),
		trailing: gs.sampledFrom(["", "/", "///"]),
	})
	.map(
		({ leading, segments, separator, trailing }) =>
			`${leading}${segments.join(separator)}${trailing}`,
	);

describe("path properties", () => {
	it("normalizes portable archive paths", () =>
		hegel.test((tc) => {
			const value = tc.draw(portablePath);
			const expected = value
				.replace(/\\/g, "/")
				.replace(/\/+/g, "/")
				.replace(/^\/|\/$/g, "");
			const normalized = normalizeHeaderName(value);

			expect(normalized).toBe(expected);
		}));

	it("rejects generated traversal components", () =>
		hegel.test((tc) => {
			const prefix = tc.draw(gs.arrays(segment, { maxSize: 5 }));
			const separator = tc.draw(gs.sampledFrom(separators));
			const name = [...prefix, "..", "outside", "escaped.txt"].join(separator);

			expect(() => normalizeHeaderName(name)).toThrow(
				/points outside extraction directory/,
			);
		}));
});
