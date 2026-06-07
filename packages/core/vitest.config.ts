import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		// Fixture files may be named *.test.ts as test data; they are not test suites.
		exclude: ["**/__tests__/fixtures/**"],
		coverage: {
			provider: "v8",
			reporter: ["text-summary", "lcov"],
			include: ["src/**/*.ts"],
			// Barrels, type-only modules, and test fixtures carry no testable logic.
			exclude: ["src/index.ts", "src/types.ts", "src/symbol-engine.ts", "src/lsp/protocol.ts", "**/__tests__/**"],
			thresholds: { lines: 80, branches: 70, functions: 80, statements: 80 }
		}
	}
});
