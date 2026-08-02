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

const separators = ["", "/", "\\", "///", "\\".repeat(3), "/\\"];

const portablePath = gs
	.record({
		leading: gs.sampledFrom(separators),
		segments: gs.arrays(segment, { minSize: 1, maxSize: 8 }),
		separator: gs.sampledFrom(["/", "\\", "//", "\\\\", "/\\"]),
		trailing: gs.sampledFrom(separators),
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
				.replace(/[\\/]+$/, "")
				.replace(/\\/g, "/")
				.replace(/^\/+/, "");
			const normalized = normalizeHeaderName(value);

			expect(normalized).toBe(expected);
		}));
});
