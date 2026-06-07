import { defineConfig } from "tsup";

// Both bins share one config; each entry emits a single ESM file into its own
// package dist. The source shebang is preserved by tsup; make the emitted bins
// executable so a global install can run them directly.
const bin = (pkg: string, external: string[]) => ({
	external,
	clean: true,
	format: ["esm"] as const,
	target: "node24" as const,
	outDir: `packages/${pkg}/dist`,
	entry: { index: `packages/${pkg}/src/index.ts` },
	onSuccess: `chmod +x packages/${pkg}/dist/index.js`
});

// Bins ship with their dependencies declared in package.json — externalize them
// (and the workspace @kestrel/core) so tsup does not inline ts-morph et al.
export default defineConfig([bin("cli", ["@kestrel/core", "citty"]), bin("mcp", ["@kestrel/core", "@modelcontextprotocol/sdk", "zod"])]);
