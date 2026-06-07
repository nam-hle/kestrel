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
			inBody: false,
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

	// tsgo's documentSymbol descends into function/method bodies; ts-morph's resolver does
	// not. A bare segment must NOT match a local declared inside a body, or a top-level const
	// collides with a same-named method local and resolves "ambiguous" (real-repo bug).
	it("ignores function/method body locals for a bare segment", () => {
		const withLocal: DocumentSymbol[] = [
			{ range: sel(0, 6), name: "DefaultState", selectionRange: sel(0, 6), kind: LspSymbolKind.Constant },
			{
				name: "Builder",
				range: sel(2, 0),
				kind: LspSymbolKind.Class,
				selectionRange: sel(2, 13),
				children: [
					{
						name: "build",
						range: sel(3, 1),
						selectionRange: sel(3, 1),
						kind: LspSymbolKind.Method,
						// A local inside the method body — tsgo lists it, kestrel must not match it.
						children: [{ range: sel(4, 2), name: "DefaultState", selectionRange: sel(4, 2), kind: LspSymbolKind.Variable }]
					}
				]
			}
		];

		const hits = resolveInSymbols(withLocal, ["DefaultState"]);
		expect(hits.map((h) => h.path)).toEqual(["DefaultState"]);
	});

	// Class/interface members stay reachable — only function/method bodies are excluded.
	it("still matches class members for a bare segment", () => {
		const hits = resolveInSymbols(tree, ["area"]);
		expect(hits.map((h) => h.path).sort()).toEqual(["Circle.area", "Shape.area"]);
	});
});
