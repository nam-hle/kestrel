import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine, renderFileOutline } from "../index.js";
import type { Candidate, SymbolHandle, UsagesResult, ResolveResult } from "../types.js";
import { renderResolve, renderHandles, renderReferences, renderCandidates } from "../render.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

function render(file: string): string {
	return renderFileOutline(file, new Engine({ tsConfigPath }).outlineFile(file));
}

describe("renderFileOutline (compact tree)", () => {
	test("namespaced file factors prefixes into a tree", () => {
		expect(render("src/nested.ts")).toMatchInlineSnapshot(`
			"src/nested.ts:
			  namespace Model
			    namespace Inner
			      interface Node  L7 [x]
			    interface Node  L2 [x]
			  namespace Runtime
			    interface Node  L14 [x]"
		`);
	});

	test("consumer file: declarations only, no function-body locals", () => {
		expect(render("src/consumer.ts")).toMatchInlineSnapshot(`
			"src/consumer.ts:
			  fn totalArea  L3 [x]
			  const averageArea  L12 [x]
			  class AreaService  L20 [x]
			  interface AreaCalculators  L27 [x]
			  fn makeCalculators  L32 [x]
			  fn makeSelectors  L41 [x]"
		`);
	});

	test("barrel file lists re-exports", () => {
		expect(render("src/barrel.ts")).toMatchInlineSnapshot(`
			"src/barrel.ts:
			  re-exports:
			    Circle
			    makeCircle
			    Shape (type)
			    * from ./square.js"
		`);
	});
});

describe("renderReferences", () => {
	test("address-first rows, tab-separated, with a summary line", () => {
		const result: UsagesResult = {
			total: 2,
			references: [
				{ test: false, kind: "call", position: { line: 6, col: 21, file: "src/a.ts" } },
				{ test: true, kind: "import", position: { line: 1, col: 10, file: "src/a.ts" } }
			]
		};
		const out = renderReferences(result);
		const lines = out.split("\n");
		expect(lines[0]).toBe("src/a.ts:6:21\tcall");
		expect(lines[1]).toBe("src/a.ts:1:10\timport\t(test)");
		expect(out).toContain("2 refs");
	});

	test("empty result renders a marker", () => {
		expect(renderReferences({ total: 0, references: [] })).toBe("(no references)");
	});

	test("context is appended after a tab when present", () => {
		const result: UsagesResult = { total: 1, references: [{ kind: "call", context: "foo()", position: { col: 1, line: 1, file: "a.ts" } }] };
		expect(renderReferences(result).split("\n")[0]).toBe("a.ts:1:1\tcall\tfoo()");
	});
});

describe("renderHandles", () => {
	test("one address row per handle", () => {
		const handles: SymbolHandle[] = [{ qualifiedName: "src/a.ts:Foo", position: { col: 1, line: 3, file: "src/a.ts" } }];
		expect(renderHandles(handles)).toBe("src/a.ts:3:1\tsrc/a.ts:Foo");
	});

	test("empty renders a marker", () => {
		expect(renderHandles([])).toBe("(none)");
	});
});

describe("renderCandidates", () => {
	test("qualifiedName-first symbol rows", () => {
		const cands: Candidate[] = [{ kind: "ClassDeclaration", qualifiedName: "src/a.ts:Circle", position: { col: 1, line: 5, file: "src/a.ts" } }];
		expect(renderCandidates(cands)).toBe("src/a.ts:Circle\tClassDeclaration\tL5");
	});
});

describe("renderResolve", () => {
	test("single symbol → one line", () => {
		const r: ResolveResult = { kind: "symbol", symbol: { qualifiedName: "src/a.ts:Foo", position: { col: 1, line: 3, file: "src/a.ts" } } };
		expect(renderResolve(r)).toBe("src/a.ts:Foo\tL3");
	});

	test("not-found with suggestions", () => {
		expect(renderResolve({ kind: "not-found", suggestions: ["Foo", "Bar"] })).toBe("not found\ndid you mean: Foo, Bar");
	});

	test("not-found without suggestions", () => {
		expect(renderResolve({ kind: "not-found" })).toBe("not found");
	});

	test("ambiguous → candidate rows", () => {
		const r: ResolveResult = {
			kind: "ambiguous",
			candidates: [{ kind: "ClassDeclaration", qualifiedName: "src/a.ts:X", position: { col: 1, line: 1, file: "src/a.ts" } }]
		};
		expect(renderResolve(r)).toBe("src/a.ts:X\tClassDeclaration\tL1");
	});
});

import { renderSource, renderRegion, renderMembers, renderStatements } from "../render.js";
import type { SourceResult, RegionResult, StatementNode } from "../types.js";

describe("renderSource", () => {
	test("header line + verbatim source with real newlines", () => {
		const s: SourceResult[] = [{ qualifiedName: "src/a.ts:f", position: { file: "src/a.ts", line: 1, col: 1 }, source: "function f() {\n\treturn 1;\n}" }];
		expect(renderSource(s)).toBe("src/a.ts:1:1\tsrc/a.ts:f\nfunction f() {\n\treturn 1;\n}");
	});

	test("multiple declarations separated by a blank line", () => {
		const s: SourceResult[] = [
			{ qualifiedName: "a:X", position: { file: "a", line: 1, col: 1 }, source: "A" },
			{ qualifiedName: "a:X", position: { file: "a", line: 5, col: 1 }, source: "B" }
		];
		expect(renderSource(s)).toBe("a:1:1\ta:X\nA\n\na:5:1\ta:X\nB");
	});
});

describe("renderRegion", () => {
	test("header + verbatim slice", () => {
		const r: RegionResult = { file: "src/a.ts", startLine: 2, endLine: 3, source: "b\nc" };
		expect(renderRegion(r)).toBe("src/a.ts:2-3\nb\nc");
	});
});

describe("renderMembers", () => {
	test("name / kind / line rows", () => {
		const m: Member[] = [{ name: "Circle.area", kind: "MethodDeclaration", signature: "area", position: { file: "a", line: 6, col: 1 } }];
		expect(renderMembers(m)).toBe("Circle.area\tMethodDeclaration\tL6");
	});
});

describe("renderStatements", () => {
	test("statement-kind tree, 2-space indent per depth", () => {
		const s: StatementNode[] = [
			{ kind: "ReturnStatement", position: { file: "a", line: 2, col: 1 } },
			{ kind: "IfStatement", position: { file: "a", line: 3, col: 1 }, children: [{ kind: "ReturnStatement", position: { file: "a", line: 4, col: 1 } }] }
		];
		expect(renderStatements(s)).toBe("ReturnStatement\tL2\nIfStatement\tL3\n  ReturnStatement\tL4");
	});
});
