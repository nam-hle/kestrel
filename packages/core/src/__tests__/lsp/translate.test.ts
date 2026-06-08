import { it, expect, describe } from "vitest";

import { uriToRelative, lspToPosition, asLocationOrNull, locationToPosition } from "../../lsp/translate.js";

const root = "/abs/project";

describe("uriToRelative", () => {
	it("strips the file:// scheme and the project root", () => {
		expect(uriToRelative("file:///abs/project/src/shapes.ts", root)).toBe("src/shapes.ts");
	});

	it("normalizes backslashes (Windows uris)", () => {
		// A real Windows-style URI with backslashes + drive root; expect forward-slashed relative.
		const winRoot = "C:/proj";
		expect(uriToRelative("file:///C:\\proj\\src\\a.ts", winRoot)).toBe("src/a.ts");
	});

	it("matches a lowercase drive letter against an uppercase root (tsgo lowercases it)", () => {
		// tsgo emits `d:/...`; the root from resolvePath keeps the OS case `D:/...`. Must still strip.
		expect(uriToRelative("file:///d:/proj/src/a.ts", "D:/proj")).toBe("src/a.ts");
	});
});

describe("lspToPosition", () => {
	it("converts 0-based line/character to 1-based line/col", () => {
		expect(lspToPosition({ line: 0, character: 0 })).toEqual({ col: 1, line: 1 });
	});
});

describe("locationToPosition", () => {
	it("builds a symantic Position from an LSP Location", () => {
		const loc = { uri: "file:///abs/project/src/shapes.ts", range: { end: { line: 4, character: 19 }, start: { line: 4, character: 13 } } };
		expect(locationToPosition(loc, root)).toEqual({ line: 5, col: 14, file: "src/shapes.ts" });
	});
});

describe("asLocationOrNull", () => {
	const range = { end: { line: 0, character: 6 }, start: { line: 0, character: 0 } };

	it("passes a plain Location through", () => {
		const loc = { range, uri: "file:///x.ts" };
		expect(asLocationOrNull(loc)).toEqual(loc);
	});

	it("normalizes a LocationLink (targetUri/targetRange) to a Location", () => {
		const link = { targetRange: range, targetUri: "file:///x.ts", targetSelectionRange: range };
		expect(asLocationOrNull(link)).toEqual({ range, uri: "file:///x.ts" });
	});

	it("returns null for a lazy/rangeless location (no range, no targetUri)", () => {
		expect(asLocationOrNull({ uri: "file:///x.ts" })).toBeNull();
	});

	it("returns null for null/undefined", () => {
		expect(asLocationOrNull(null)).toBeNull();
		expect(asLocationOrNull(undefined)).toBeNull();
	});
});
