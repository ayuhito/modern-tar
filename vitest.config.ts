import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "node",
					include: ["tests/{fs,tar,web}/**/*.test.ts"],
				},
			},
			{
				test: {
					name: "workers",
					include: ["tests/workers/**/*.test.ts"],
				},
			},
			{
				test: {
					name: "browser",
					include: ["tests/browser/**/*.test.ts"],
					browser: {
						enabled: true,
						headless: true,
						screenshotFailures: false,
						provider: playwright(),
						instances: [
							{ browser: "chromium" },
							{ browser: "firefox" },
							{ browser: "webkit" },
						],
					},
				},
			},
		],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
		},
	},
});
