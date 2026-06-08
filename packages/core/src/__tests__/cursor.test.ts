import { test, expect, describe } from "vitest";

import { parsePageCursor } from "../cursor.js";

describe("parsePageCursor", () => {
	test("undefined / empty → offset 0", () => {
		expect(parsePageCursor(undefined)).toBe(0);
		expect(parsePageCursor("")).toBe(0);
	});

	test("a non-negative integer string → that offset", () => {
		expect(parsePageCursor("0")).toBe(0);
		expect(parsePageCursor("42")).toBe(42);
	});

	test("throws on non-numeric, negative, or fractional cursors", () => {
		expect(() => parsePageCursor("abc")).toThrow(/invalid cursor/);
		expect(() => parsePageCursor("-1")).toThrow(/invalid cursor/);
		expect(() => parsePageCursor("1.5")).toThrow(/invalid cursor/);
		expect(() => parsePageCursor("NaN")).toThrow(/invalid cursor/);
	});
});
