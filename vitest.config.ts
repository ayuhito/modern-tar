import { playwright } from "@vitest/browser-playwright";
import { defineConfig, defineProject } from "vitest/config";

const server = {
	watch: {
		ignored: ["**/tests/fs/fixtures/e/symlink"],
	},
};

export default defineConfig({
	test: {
		projects: [
			defineProject({
				server,
				test: {
					name: "node",
					include: ["tests/{fs,tar,web}/**/*.test.ts"],
				},
			}),
			defineProject({
				server,
				test: {
					name: "workers",
					include: ["tests/workers/**/*.test.ts"],
				},
			}),
			defineProject({
				server,
				test: {
					name: "browser",
					include: ["tests/browser/**/*.test.ts"],
					browser: {
						enabled: true,
						headless: true,
						screenshotFailures: false,
						provider: playwright(),
						instances: [{ browser: "chromium" }, { browser: "firefox" }],
					},
				},
			}),
		],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			thresholds: {
				statements: 91.95,
				branches: 87.36,
				functions: 96.7,
				lines: 94.82,
			},
		},
	},
});
