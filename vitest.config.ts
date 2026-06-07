import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["packages/*/src/**/*.test.ts"],
		// Never pick up compiled tests from dist, and treat fixture *.test.ts as data, not suites.
		exclude: ["**/dist/**", "**/node_modules/**", "**/__tests__/fixtures/**"],
		coverage: {
			provider: "v8",
			reporter: ["text-summary", "lcov"],
			include: ["packages/*/src/**/*.ts"],
			// Barrels, type-only modules, and test fixtures carry no testable logic.
			exclude: ["**/index.ts", "**/types.ts", "**/symbol-engine.ts", "**/lsp/protocol.ts", "**/__tests__/**"],
			thresholds: { lines: 80, branches: 70, functions: 80, statements: 80 }
		}
	}
});
