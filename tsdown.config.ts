import { defineConfig } from "tsdown";

export default defineConfig([
	{
		entry: ["./src/web/index.ts", "./src/fs/index.ts"],
		platform: "node",
		dts: {
			build: true,
		},
		plugins: [
			{
				name: "strip-tsdoc",
				generateBundle(_options, bundle) {
					for (const [fileName, chunk] of Object.entries(bundle)) {
						if (chunk.type === "chunk" && fileName.endsWith(".js")) {
							chunk.code = chunk.code.replace(
								/\n?\s*\/\*\*[\s\S]*?\*\/\s*\n?/g,
								"\n",
							);
						}
					}
				},
			},
		],
	},
]);
