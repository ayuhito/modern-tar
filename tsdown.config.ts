import { defineConfig } from "tsdown";

export default defineConfig([
	{
		entry: ["./src/web/index.ts", "./src/fs/index.ts"],
		platform: "node",
		dts: {
			build: true,
		},
	},
]);
