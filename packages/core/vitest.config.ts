import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		// Fixture files may be named *.test.ts as test data; they are not test suites.
		exclude: ["**/__tests__/fixtures/**"]
	}
});
