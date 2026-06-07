import { it, expect, describe } from "vitest";

import { uriToRelative, lspToPosition, locationToPosition } from "../../lsp/translate.js";

const root = "/abs/project";

describe("uriToRelative", () => {
	it("strips the file:// scheme and the project root", () => {
		expect(uriToRelative("file:///abs/project/src/shapes.ts", root)).toBe("src/shapes.ts");
	});

	it("normalizes backslashes (Windows uris)", () => {
		expect(uriToRelative("file:///abs/project/src/a.ts", root)).toBe("src/a.ts");
	});
});

describe("lspToPosition", () => {
	it("converts 0-based line/character to 1-based line/col", () => {
		expect(lspToPosition({ line: 0, character: 0 })).toEqual({ col: 1, line: 1 });
	});
});

describe("locationToPosition", () => {
	it("builds a kestrel Position from an LSP Location", () => {
		const loc = { uri: "file:///abs/project/src/shapes.ts", range: { end: { line: 4, character: 19 }, start: { line: 4, character: 13 } } };
		expect(locationToPosition(loc, root)).toEqual({ line: 5, col: 14, file: "src/shapes.ts" });
	});
});
