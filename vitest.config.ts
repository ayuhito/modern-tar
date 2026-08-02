import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const server = {
	watch: {
		ignored: ["**/tests/fs/fixtures/e/symlink"],
	},
};

export default defineConfig({
	test: {
		projects: [
			{
				server,
				test: {
					name: "node",
					include: ["tests/{fs,tar,web}/**/*.test.ts"],
				},
			},
			{
				server,
				test: {
					name: "workers",
					include: ["tests/workers/**/*.test.ts"],
				},
			},
			{
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
			},
		],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			thresholds: {
				statements: 91.89,
				branches: 87.36,
				functions: 96.7,
				lines: 94.82,
			},
		},
	},
});
