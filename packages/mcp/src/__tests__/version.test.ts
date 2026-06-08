import { it, expect, describe } from "vitest";

import { readVersion } from "../version.js";

describe("readVersion", () => {
	it("returns a semver-shaped string read from package.json", () => {
		expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
	});

	it("never throws", () => {
		expect(() => readVersion()).not.toThrow();
	});
});
