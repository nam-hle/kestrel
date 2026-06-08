import { it, expect, describe } from "vitest";

import { readVersion } from "../version.js";

describe("readVersion", () => {
	it("returns a semver-shaped string read from package.json", () => {
		// In the test (non-bundled) layout, import.meta.url is under src/, so package.json is
		// one level up from dist at runtime — here it resolves to the package's own version.
		const v = readVersion();
		expect(v).toMatch(/^\d+\.\d+\.\d+/);
	});

	it("never throws", () => {
		expect(() => readVersion()).not.toThrow();
	});
});
