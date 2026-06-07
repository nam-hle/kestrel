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

import type { Member, SourceResult, RegionResult, StatementNode } from "../types.js";
import { renderSource, renderRegion, renderMembers, renderStatements } from "../render.js";

describe("renderSource", () => {
	test("header line + verbatim source with real newlines", () => {
		const s: SourceResult[] = [
			{ qualifiedName: "src/a.ts:f", source: "function f() {\n\treturn 1;\n}", position: { col: 1, line: 1, file: "src/a.ts" } }
		];
		expect(renderSource(s)).toBe("src/a.ts:1:1\tsrc/a.ts:f\nfunction f() {\n\treturn 1;\n}");
	});

	test("multiple declarations separated by a blank line", () => {
		const s: SourceResult[] = [
			{ source: "A", qualifiedName: "a:X", position: { col: 1, line: 1, file: "a" } },
			{ source: "B", qualifiedName: "a:X", position: { col: 1, line: 5, file: "a" } }
		];
		expect(renderSource(s)).toBe("a:1:1\ta:X\nA\n\na:5:1\ta:X\nB");
	});
});

describe("renderRegion", () => {
	test("header + verbatim slice", () => {
		const r: RegionResult = { endLine: 3, startLine: 2, source: "b\nc", file: "src/a.ts" };
		expect(renderRegion(r)).toBe("src/a.ts:2-3\nb\nc");
	});
});

describe("renderMembers", () => {
	test("name / kind / line rows", () => {
		const m: Member[] = [{ signature: "area", name: "Circle.area", kind: "MethodDeclaration", position: { col: 1, line: 6, file: "a" } }];
		expect(renderMembers(m)).toBe("Circle.area\tMethodDeclaration\tL6");
	});
});

describe("renderStatements", () => {
	test("statement-kind tree, 2-space indent per depth", () => {
		const s: StatementNode[] = [
			{ kind: "ReturnStatement", position: { col: 1, line: 2, file: "a" } },
			{
				kind: "IfStatement",
				position: { col: 1, line: 3, file: "a" },
				children: [{ kind: "ReturnStatement", position: { col: 1, line: 4, file: "a" } }]
			}
		];
		expect(renderStatements(s)).toBe("ReturnStatement\tL2\nIfStatement\tL3\n  ReturnStatement\tL4");
	});
});

import type { CallNode, ImportInfo, SymbolContext, UsageReportEntry } from "../types.js";
import { renderImports, renderContext, renderUsageReport, renderCallHierarchy } from "../render.js";

describe("renderCallHierarchy", () => {
	test("indented tree: name + address, 2 spaces per level", () => {
		const tree: CallNode[] = [
			{
				qualifiedName: "a:totalArea",
				position: { col: 1, line: 3, file: "a" },
				calls: [{ calls: [], qualifiedName: "a:avg", position: { col: 1, line: 12, file: "a" } }]
			}
		];
		expect(renderCallHierarchy(tree)).toBe("totalArea\ta:3:1\n  avg\ta:12:1");
	});

	test("empty → marker", () => {
		expect(renderCallHierarchy([])).toBe("(none)");
	});
});

describe("renderContext", () => {
	test("labeled sections + source after a divider", () => {
		const ctx: SymbolContext = {
			qualifiedName: "a:f",
			typeRefs: ["Circle"],
			signature: "function f(): number",
			position: { col: 1, line: 3, file: "a" },
			source: "function f() {\n\treturn 1;\n}",
			callees: [{ calls: [], qualifiedName: "a:g", position: { col: 5, line: 9, file: "a" } }]
		};
		const out = renderContext(ctx);
		expect(out).toContain("a:3:1\ta:f");
		expect(out).toContain("sig: function f(): number");
		expect(out).toContain("types: Circle");
		expect(out).toContain("callees:");
		expect(out).toContain("  g\ta:9:5");
		expect(out).toContain("---");
		expect(out).toContain("function f() {");
	});

	test("omits empty sections", () => {
		const ctx: SymbolContext = {
			callees: [],
			typeRefs: [],
			qualifiedName: "a:f",
			signature: "const f",
			source: "const f = 1",
			position: { col: 1, line: 1, file: "a" }
		};
		const out = renderContext(ctx);
		expect(out).not.toContain("types:");
		expect(out).not.toContain("callees:");
	});
});

describe("renderImports", () => {
	test("module + named", () => {
		const imps: ImportInfo[] = [{ module: "./shapes.js", named: ["makeCircle", "Circle"], position: { col: 1, line: 1, file: "a" } }];
		expect(renderImports(imps)).toBe("./shapes.js\tmakeCircle, Circle");
	});

	test("default + namespace annotated", () => {
		const imps: ImportInfo[] = [{ named: [], module: "react", namespace: "ns", default: "React", position: { col: 1, line: 1, file: "a" } }];
		expect(renderImports(imps)).toBe("react\tdefault React\t* as ns");
	});
});

describe("renderUsageReport", () => {
	test("name + counts + kind", () => {
		const rows: UsageReportEntry[] = [
			{ total: 5, consumed: 3, qualifiedName: "a:Foo", kind: "ClassDeclaration", position: { col: 1, line: 1, file: "a" } }
		];
		expect(renderUsageReport(rows)).toBe("a:Foo\ttotal=5 consumed=3\tClassDeclaration");
	});
});
