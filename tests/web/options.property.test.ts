import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { describe, expect, it } from "vitest";
import { transformHeader } from "../../src/tar/options";
import type { TarHeader } from "../../src/tar/types";

const segment = gs.text({
	alphabet: "abcdefghijklmnopqrstuvwxyz0123456789-_",
	minSize: 1,
	maxSize: 16,
});

const scenario = gs.record({
	absoluteLink: gs.sampledFrom([false, true]),
	segments: gs.arrays(segment, { minSize: 1, maxSize: 8 }),
	strip: gs.integers({ minValue: 0, maxValue: 10 }),
	targetSegments: gs.arrays(segment, { minSize: 1, maxSize: 8 }),
	type: gs.sampledFrom(["file", "directory", "symlink", "link"] as const),
});

const stripPath = (parts: readonly string[], count: number) =>
	count >= parts.length ? "" : parts.slice(count).join("/");

describe("unpack option properties", () => {
	it("strips entry and link paths according to their archive semantics", () =>
		hegel.test((tc) => {
			const value = tc.draw(scenario);
			const link = value.type === "symlink" || value.type === "link";
			const rawLinkname = value.targetSegments.join("/");
			const linkname = link
				? `${value.absoluteLink ? "/" : ""}${rawLinkname}`
				: undefined;
			const header: TarHeader = {
				name: `${value.segments.join("/")}${value.type === "directory" ? "/" : ""}`,
				size: 0,
				type: value.type,
				linkname,
			};

			const actual = transformHeader(header, { strip: value.strip });
			if (value.strip === 0) {
				expect(actual).toBe(header);
				return;
			}

			const name = stripPath(value.segments, value.strip);
			if (!name) {
				expect(actual).toBeNull();
				return;
			}

			let expectedLinkname = linkname;
			if (linkname && (value.absoluteLink || value.type === "link")) {
				const stripped = stripPath(value.targetSegments, value.strip);
				expectedLinkname = value.absoluteLink ? `/${stripped}` : stripped;
			}

			expect(actual).toMatchObject({
				name: `${name}${value.type === "directory" ? "/" : ""}`,
				type: value.type,
				linkname: expectedLinkname,
			});
		}));
});
