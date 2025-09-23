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
			"**/packages/fs/tests/fixtures/e/symlink",
		],
	},
	server: {
		watch: {
			// Disable file system watching for symlinks to prevent infinite loops
			ignored: ["**/packages/fs/tests/fixtures/e/symlink"],
		},
	},
});
