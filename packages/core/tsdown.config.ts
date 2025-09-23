import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["./src/index.ts"],
	platform: "neutral",
	exports: true,
	dts: true,
});
