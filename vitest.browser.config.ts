import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/browser/**/*.test.ts"],
		exclude: ["vitest-example/**"],
		browser: {
			enabled: true,
			headless: true,
			screenshotFailures: false,
			provider: playwright(),
			instances: [{ browser: "chromium" }, { browser: "firefox" }],
		},
	},
	server: {
		watch: {
			// Disable file system watching for symlinks to prevent infinite loops
			ignored: ["**/tests/fs/fixtures/e/symlink"],
		},
	},
});
