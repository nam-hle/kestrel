import { test, expect, describe } from "vitest";

import { parseQualifiedName } from "../resolve.js";

describe("parseQualifiedName", () => {
	test("parses file:name", () => {
		expect(parseQualifiedName("src/a.ts:Foo")).toEqual({ file: "src/a.ts", index: undefined, segments: ["Foo"] });
	});

	test("parses a dotted namespace path", () => {
		expect(parseQualifiedName("src/a.ts:Model.Inner.Node")).toEqual({
			file: "src/a.ts",
			index: undefined,
			segments: ["Model", "Inner", "Node"]
		});
	});

	test("parses file:name#index", () => {
		expect(parseQualifiedName("src/a.ts:Foo#2")).toEqual({
			index: 2,
			file: "src/a.ts",
			segments: ["Foo"]
		});
	});

	test("throws when the separator is missing", () => {
		expect(() => parseQualifiedName("noseparator")).toThrow(/expected file:name/);
	});

	test("throws on a non-integer index", () => {
		expect(() => parseQualifiedName("src/a.ts:Foo#x")).toThrow(/invalid index/);
	});

	test("throws on a negative index", () => {
		expect(() => parseQualifiedName("src/a.ts:Foo#-1")).toThrow(/invalid index/);
	});
});
