import { it, expect, describe } from "vitest";

import { LspSymbolKind } from "../../lsp/protocol.js";
import { resolveInSymbols } from "../../lsp/bridge.js";
import type { DocumentSymbol } from "../../lsp/protocol.js";

const sel = (line: number, character: number) => ({ start: { line, character }, end: { line, character: character + 1 } });

// Shape interface (line 0) with member area; Circle class (line 4) with member area.
const tree: DocumentSymbol[] = [
	{
		name: "Shape",
		range: sel(0, 0),
		selectionRange: sel(0, 17),
		kind: LspSymbolKind.Interface,
		children: [{ name: "area", range: sel(1, 1), selectionRange: sel(1, 1), kind: LspSymbolKind.Method }]
	},
	{
		name: "Circle",
		range: sel(4, 0),
		kind: LspSymbolKind.Class,
		selectionRange: sel(4, 13),
		children: [{ name: "area", range: sel(6, 1), selectionRange: sel(6, 1), kind: LspSymbolKind.Method }]
	}
];

describe("resolveInSymbols", () => {
	it("resolves a top-level name to its selectionRange start", () => {
		const hits = resolveInSymbols(tree, ["Circle"]);
		expect(hits).toHaveLength(1);
		expect(hits[0]).toEqual({
			name: "Circle",
			path: "Circle",
			kind: LspSymbolKind.Class,
			position: { line: 4, character: 13 },
			rangeStart: { line: 4, character: 0 }
		});
	});

	it("resolves a dotted member path exactly", () => {
		const hits = resolveInSymbols(tree, ["Circle", "area"]);
		expect(hits).toHaveLength(1);
		expect(hits[0]!.path).toBe("Circle.area");
		expect(hits[0]!.position).toEqual({ line: 6, character: 1 });
	});

	it("matches a bare segment at any depth (collisions returned as multiple)", () => {
		const hits = resolveInSymbols(tree, ["area"]);
		expect(hits.map((h) => h.path).sort()).toEqual(["Circle.area", "Shape.area"]);
	});
});
