import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	clean: true,
	target: "node24",
	// The source shebang is preserved by tsup; make the emitted CLI executable.
	onSuccess: "chmod +x dist/index.js"
});
