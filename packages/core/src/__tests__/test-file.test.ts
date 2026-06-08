import { test, expect, describe } from "vitest";

import { isTestFile } from "../test-file.js";

describe("isTestFile", () => {
	test("matches .test. / .spec. / __tests__ / e2e", () => {
		expect(isTestFile("src/foo.test.ts")).toBe(true);
		expect(isTestFile("src/foo.spec.ts")).toBe(true);
		expect(isTestFile("src/__tests__/foo.ts")).toBe(true);
		expect(isTestFile("src/e2e/foo.ts")).toBe(true);
	});

	test("does not match plain source files", () => {
		expect(isTestFile("src/foo.ts")).toBe(false);
		expect(isTestFile("src/testing.ts")).toBe(false);
	});
});
