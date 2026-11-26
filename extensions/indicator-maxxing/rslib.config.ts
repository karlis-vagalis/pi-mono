import { defineConfig } from "@rslib/core";

export default defineConfig({
	source: { entry: { index: "./src/index.ts" } },
	lib: [{ format: "esm", bundle: true, dts: false, syntax: "es2023" }],
	output: { target: "node" },
});
