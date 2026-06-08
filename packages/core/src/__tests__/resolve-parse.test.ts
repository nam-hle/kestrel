import { test, expect, describe } from "vitest";

import { parseQualifiedName } from "../resolve.js";

describe("parseQualifiedName", () => {
	test("parses file:name", () => {
		expect(parseQualifiedName("src/a.ts:Foo")).toEqual({ file: "src/a.ts", index: undefined, segments: ["Foo"] });
	});

	test("parses a :: namespace path", () => {
		expect(parseQualifiedName("src/a.ts:Model::Inner::Node")).toEqual({
			file: "src/a.ts",
			index: undefined,
			segments: ["Model", "Inner", "Node"]
		});
	});

	test("splits file from name at the first lone colon, keeping :: in the name", () => {
		expect(parseQualifiedName("src/a.ts:Model::Inner")).toEqual({
			file: "src/a.ts",
			index: undefined,
			segments: ["Model", "Inner"]
		});
	});

	test("keeps dots inside a quoted module-name segment intact", () => {
		expect(parseQualifiedName('src/a.ts:"@scope.org/pkg.sub"::Extra')).toEqual({
			file: "src/a.ts",
			index: undefined,
			segments: ['"@scope.org/pkg.sub"', "Extra"]
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

	test("throws on an empty file part", () => {
		expect(() => parseQualifiedName(":Foo")).toThrow(/empty file/);
	});

	test("throws on an empty name part", () => {
		expect(() => parseQualifiedName("src/a.ts:")).toThrow(/empty name/);
	});

	test("throws on an empty segment (leading separator)", () => {
		expect(() => parseQualifiedName("src/a.ts:::Foo")).toThrow(/empty segment/);
	});

	test("throws on an empty segment (trailing separator)", () => {
		expect(() => parseQualifiedName("src/a.ts:Foo::")).toThrow(/empty segment/);
	});

	test("throws on an empty segment (doubled separator)", () => {
		expect(() => parseQualifiedName("src/a.ts:Foo::::Bar")).toThrow(/empty segment/);
	});

	test("parse errors carry a self-help syntax hint", () => {
		expect(() => parseQualifiedName("noColon")).toThrow(/syntax:.*::/s);
		expect(() => parseQualifiedName("src/a.ts:Foo::")).toThrow(/syntax:.*::/s);
	});
});
