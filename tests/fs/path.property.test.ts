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

const portablePath = gs.composite((tc) => {
	const segments = tc.draw(gs.arrays(segment, { minSize: 1, maxSize: 8 }));
	const separator = tc.draw(gs.sampledFrom(["/", "\\", "//", "\\\\", "/\\"]));
	const leadingSlashes = tc.draw(gs.integers({ minValue: 0, maxValue: 4 }));
	const trailingSlashes = tc.draw(gs.integers({ minValue: 0, maxValue: 4 }));

	return `${"/".repeat(leadingSlashes)}${segments.join(separator)}${"/".repeat(trailingSlashes)}`;
});

describe("path properties", () => {
	it("normalizes portable archive paths", () =>
		hegel.test((tc) => {
			const value = tc.draw(portablePath);
			const expected = value
				.replace(/\/+$/, "")
				.replace(/\\/g, "/")
				.replace(/^\/+/, "");
			const normalized = normalizeHeaderName(value);

			expect(normalized).toBe(expected);
			expect(normalizeHeaderName(normalized)).toBe(normalized);
			expect(normalized).not.toContain("\\");
			expect(normalized.startsWith("/")).toBe(false);
			expect(normalized.endsWith("/")).toBe(false);
		}));
});
