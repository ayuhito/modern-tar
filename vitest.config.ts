import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/cypress/**",
			"**/.{idea,git,cache,output,temp}/**",
			"**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
			// Exclude problematic symlink fixtures that cause ELOOP errors
			"**/tests/fs/fixtures/e/symlink",
		],
		coverage: {
			exclude: [
				"**/node_modules/**",
				"**/dist/**",
				"**/.{idea,git,cache,output,temp}/**",
				"**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
				"**/tests/**",
				"**/benchmarks/**",
				"tsdown.config.ts",
			],
		},
	},
	server: {
		watch: {
			// Disable file system watching for symlinks to prevent infinite loops
			ignored: ["**/tests/fs/fixtures/e/symlink"],
		},
	},
});
