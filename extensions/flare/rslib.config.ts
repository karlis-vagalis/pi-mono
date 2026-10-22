import { defineConfig } from "@rslib/core";

export default defineConfig({
	source: {
		entry: { index: ["./src/**/*.ts"] },
	},
	lib: [{ format: "esm", bundle: false, dts: false, syntax: "es2023" }],
	output: {
		target: "node",
		copy: [{ from: "./src/gateway.js", to: "gateway.js" }],
	},
});
