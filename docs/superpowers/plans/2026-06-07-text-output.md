# Token-lean Text Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every kestrel op print dense, address-first text by default (RTK-style) across CLI and MCP, with `--json` / `json: true` as the structured opt-in.

**Architecture:** Add one pure `render*(struct) -> string` per op to `packages/core/src/render.ts` (joining the existing `renderFileOutline`). Engines still return structs; renderers are presentation-only. CLI prints `render*` by default and the struct as pretty JSON under `--json`; MCP returns the rendered text in `content[0].text` by default and pretty JSON under `json: true`.

**Tech Stack:** TypeScript 6, vitest, citty (CLI), `@modelcontextprotocol/sdk` + zod (MCP), nadle.

**Source of truth:** [docs/superpowers/specs/2026-06-07-token-lean-text-output.md](../specs/2026-06-07-token-lean-text-output.md).

## Conventions (every task)

- ESM, `.js` suffixes, strict TS. Prettier TABS, printWidth 150. eslint perfectionist auto-fix OK; >4-param functions fail `max-params` (bundle to an options object).
- TDD: write the failing test, run it, see it fail, implement, see it pass.
- Verify from REPO ROOT: `pnpm exec nadle test`, `pnpm exec nadle check`, `pnpm build`.
- Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; imperative subject ≤50 chars.
- Branch `feat/text-output` is checked out — work on it; do NOT branch.
- **Format rules** (from the spec): address-first; fields tab-separated (`\t`), no space-padding; omit empty fields; real newlines in source; trees indent 2 spaces/level. Location ops lead `file:line:col`; symbol ops lead `file:Name`.

## File structure

```
packages/core/src/render.ts          (modify) add all render* functions beside renderFileOutline
packages/core/src/index.ts           (modify) export the new render* functions
packages/core/src/__tests__/render.test.ts  (modify/extend) unit tests per renderer
packages/cli/src/index.ts            (modify) text default + --json per command via output()
packages/mcp/src/index.ts            (modify) text default + json arg per tool
packages/cli/src/__tests__/cli.test.ts  (modify) text-default + --json assertions
packages/mcp/src/__tests__/mcp.test.ts  (modify) text-default + json:true assertions
```

---

## Task 1: Row renderers (refs, def/impls, candidates, resolve)

**Files:**

- Modify: `packages/core/src/render.ts`
- Test: `packages/core/src/__tests__/render.test.ts`

These share an address-first row shape. A small `addr(pos)` helper formats `file:line:col`.

- [ ] **Step 1: Write failing tests** — create/extend `packages/core/src/__tests__/render.test.ts`:

```typescript
import { test, expect, describe } from "vitest";

import { renderResolve, renderReferences, renderHandles, renderCandidates } from "../render.js";
import type { Reference, Candidate, SymbolHandle, ResolveResult, UsagesResult } from "../types.js";

describe("renderReferences", () => {
	test("address-first rows, tab-separated, with a summary line", () => {
		const result: UsagesResult = {
			total: 2,
			references: [
				{ position: { file: "src/a.ts", line: 6, col: 21 }, kind: "call", test: false },
				{ position: { file: "src/a.ts", line: 1, col: 10 }, kind: "import", test: true }
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
		const result: UsagesResult = { total: 1, references: [{ position: { file: "a.ts", line: 1, col: 1 }, kind: "call", context: "foo()" }] };
		expect(renderReferences(result).split("\n")[0]).toBe("a.ts:1:1\tcall\tfoo()");
	});
});

describe("renderHandles", () => {
	test("one address row per handle", () => {
		const handles: SymbolHandle[] = [{ qualifiedName: "src/a.ts:Foo", position: { file: "src/a.ts", line: 3, col: 1 } }];
		expect(renderHandles(handles)).toBe("src/a.ts:3:1\tsrc/a.ts:Foo");
	});

	test("empty renders a marker", () => {
		expect(renderHandles([])).toBe("(none)");
	});
});

describe("renderCandidates", () => {
	test("qualifiedName-first symbol rows", () => {
		const cands: Candidate[] = [{ qualifiedName: "src/a.ts:Circle", kind: "ClassDeclaration", position: { file: "src/a.ts", line: 5, col: 1 } }];
		expect(renderCandidates(cands)).toBe("src/a.ts:Circle\tClassDeclaration\tL5");
	});
});

describe("renderResolve", () => {
	test("single symbol → one line", () => {
		const r: ResolveResult = { kind: "symbol", symbol: { qualifiedName: "src/a.ts:Foo", position: { file: "src/a.ts", line: 3, col: 1 } } };
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
			candidates: [{ qualifiedName: "src/a.ts:X", kind: "ClassDeclaration", position: { file: "src/a.ts", line: 1, col: 1 } }]
		};
		expect(renderResolve(r)).toBe("src/a.ts:X\tClassDeclaration\tL1");
	});
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm exec nadle test` (functions not exported).

- [ ] **Step 3: Implement** — append to `packages/core/src/render.ts` (add the imports to its `import type` line):

```typescript
import type {
	Member,
	Candidate,
	Position,
	CallNode,
	ImportInfo,
	FileOutline,
	SourceResult,
	RegionResult,
	SymbolHandle,
	UsagesResult,
	ResolveResult,
	SymbolContext,
	StatementNode,
	UsageReportEntry
} from "./types.js";

/** Re-feedable address of a position: file:line:col. */
function addr(pos: Position): string {
	return `${pos.file}:${pos.line}:${pos.col}`;
}

/** A symbol-row: qualifiedName-first (the next-query input), kind + line after. */
function candidateRow(c: Candidate): string {
	return `${c.qualifiedName}\t${c.kind}\tL${c.position.line}`;
}

export function renderReferences(result: UsagesResult): string {
	if (result.references.length === 0) {
		return "(no references)";
	}

	const rows = result.references.map((r) => {
		const parts = [addr(r.position), r.kind];

		if (r.context !== undefined) {
			parts.push(r.context);
		} else if (r.test === true) {
			parts.push("(test)");
		}

		// When both context and test apply, keep test marker too.
		if (r.context !== undefined && r.test === true) {
			parts.push("(test)");
		}

		return parts.join("\t");
	});
	const cursor = result.nextCursor !== undefined ? ` (more: cursor ${result.nextCursor})` : "";

	return `${rows.join("\n")}\n${result.total} refs${cursor}`;
}

export function renderHandles(handles: SymbolHandle[]): string {
	if (handles.length === 0) {
		return "(none)";
	}

	return handles.map((h) => `${addr(h.position)}\t${h.qualifiedName}`).join("\n");
}

export function renderCandidates(candidates: Candidate[]): string {
	return candidates.length === 0 ? "(none)" : candidates.map(candidateRow).join("\n");
}

export function renderResolve(result: ResolveResult): string {
	if (result.kind === "symbol") {
		return `${result.symbol.qualifiedName}\tL${result.symbol.position.line}`;
	}

	if (result.kind === "ambiguous") {
		return result.candidates.map(candidateRow).join("\n");
	}

	return result.suggestions !== undefined && result.suggestions.length > 0
		? `not found\ndid you mean: ${result.suggestions.join(", ")}`
		: "not found";
}
```

(NOTE on the refs row: the test+context interplay above double-pushes `(test)`; simplify the implementation to build parts cleanly — `[addr, kind, ...(context?[context]:[]), ...(test?["(test)"]:[])].join("\t")`. Match the tests: context-only row has no `(test)`, test-only row has `(test)`, a row with both has context then `(test)`.)

- [ ] **Step 4: Run, verify PASS** — `pnpm exec nadle test`.

- [ ] **Step 5: Export + commit** — add the four to `packages/core/src/index.ts` (`export { renderFileOutline, renderReferences, renderHandles, renderCandidates, renderResolve } from "./render.js";`), then:

```bash
git add packages/core/src/render.ts packages/core/src/index.ts packages/core/src/__tests__/render.test.ts
git commit -m "Add row renderers (refs, handles, candidates, resolve)"
```

---

## Task 2: Source / region / members / statements renderers

**Files:**

- Modify: `packages/core/src/render.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/render.test.ts`

- [ ] **Step 1: Write failing tests** (append):

```typescript
import { renderSource, renderRegion, renderMembers, renderStatements } from "../render.js";
import type { SourceResult, RegionResult, StatementNode } from "../types.js";

describe("renderSource", () => {
	test("header line + verbatim source with real newlines", () => {
		const s: SourceResult[] = [
			{ qualifiedName: "src/a.ts:f", position: { file: "src/a.ts", line: 1, col: 1 }, source: "function f() {\n\treturn 1;\n}" }
		];
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
			{
				kind: "IfStatement",
				position: { file: "a", line: 3, col: 1 },
				children: [{ kind: "ReturnStatement", position: { file: "a", line: 4, col: 1 } }]
			}
		];
		expect(renderStatements(s)).toBe("ReturnStatement\tL2\nIfStatement\tL3\n  ReturnStatement\tL4");
	});
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** (append to `render.ts`):

```typescript
export function renderSource(sources: SourceResult[]): string {
	if (sources.length === 0) {
		return "(no source)";
	}

	return sources.map((s) => `${addr(s.position)}\t${s.qualifiedName}\n${s.source}`).join("\n\n");
}

export function renderRegion(r: RegionResult): string {
	return `${r.file}:${r.startLine}-${r.endLine}\n${r.source}`;
}

export function renderMembers(members: Member[]): string {
	return members.length === 0 ? "(no members)" : members.map((m) => `${m.name}\t${m.kind}\tL${m.position.line}`).join("\n");
}

export function renderStatements(nodes: StatementNode[], indent = ""): string {
	if (nodes.length === 0 && indent === "") {
		return "(empty)";
	}

	const lines: string[] = [];

	for (const node of nodes) {
		lines.push(`${indent}${node.kind}\tL${node.position.line}`);

		if (node.children !== undefined && node.children.length > 0) {
			lines.push(renderStatements(node.children, `${indent}  `));
		}
	}

	return lines.join("\n");
}
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Export + commit** — add the four to `index.ts`, then:

```bash
git add packages/core/src/render.ts packages/core/src/index.ts packages/core/src/__tests__/render.test.ts
git commit -m "Add source/region/members/statements renderers"
```

---

## Task 3: Context / callHierarchy / imports / usageReport renderers

**Files:**

- Modify: `packages/core/src/render.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/render.test.ts`

- [ ] **Step 1: Write failing tests** (append):

```typescript
import { renderImports, renderContext, renderCallHierarchy, renderUsageReport } from "../render.js";
import type { CallNode, ImportInfo, SymbolContext, UsageReportEntry } from "../types.js";

describe("renderCallHierarchy", () => {
	test("indented tree: name + address, 2 spaces per level", () => {
		const tree: CallNode[] = [
			{
				qualifiedName: "a:totalArea",
				position: { file: "a", line: 3, col: 1 },
				calls: [{ qualifiedName: "a:avg", position: { file: "a", line: 12, col: 1 }, calls: [] }]
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
			position: { file: "a", line: 3, col: 1 },
			signature: "function f(): number",
			source: "function f() {\n\treturn 1;\n}",
			typeRefs: ["Circle"],
			callees: [{ qualifiedName: "a:g", position: { file: "a", line: 9, col: 5 }, calls: [] }]
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
			qualifiedName: "a:f",
			position: { file: "a", line: 1, col: 1 },
			signature: "const f",
			source: "const f = 1",
			typeRefs: [],
			callees: []
		};
		const out = renderContext(ctx);
		expect(out).not.toContain("types:");
		expect(out).not.toContain("callees:");
	});
});

describe("renderImports", () => {
	test("module + named", () => {
		const imps: ImportInfo[] = [{ module: "./shapes.js", named: ["makeCircle", "Circle"], position: { file: "a", line: 1, col: 1 } }];
		expect(renderImports(imps)).toBe("./shapes.js\tmakeCircle, Circle");
	});

	test("default + namespace annotated", () => {
		const imps: ImportInfo[] = [{ module: "react", named: [], default: "React", namespace: "ns", position: { file: "a", line: 1, col: 1 } }];
		expect(renderImports(imps)).toBe("react\tdefault React\t* as ns");
	});
});

describe("renderUsageReport", () => {
	test("name + counts + kind", () => {
		const rows: UsageReportEntry[] = [
			{ qualifiedName: "a:Foo", kind: "ClassDeclaration", total: 5, consumed: 3, position: { file: "a", line: 1, col: 1 } }
		];
		expect(renderUsageReport(rows)).toBe("a:Foo\ttotal=5 consumed=3\tClassDeclaration");
	});
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** (append to `render.ts`):

```typescript
function renderCallNodes(nodes: CallNode[], indent: string, lines: string[]): void {
	for (const node of nodes) {
		const name = node.qualifiedName.split(":").pop() ?? node.qualifiedName;
		lines.push(`${indent}${name}\t${addr(node.position)}`);
		renderCallNodes(node.calls, `${indent}  `, lines);
	}
}

export function renderCallHierarchy(tree: CallNode[]): string {
	if (tree.length === 0) {
		return "(none)";
	}

	const lines: string[] = [];
	renderCallNodes(tree, "", lines);

	return lines.join("\n");
}

export function renderContext(ctx: SymbolContext): string {
	const lines = [`${addr(ctx.position)}\t${ctx.qualifiedName}`, `sig: ${ctx.signature}`];

	if (ctx.typeRefs.length > 0) {
		lines.push(`types: ${ctx.typeRefs.join(", ")}`);
	}

	if (ctx.callees.length > 0) {
		lines.push("callees:");
		const calleeLines: string[] = [];
		renderCallNodes(ctx.callees, "  ", calleeLines);
		lines.push(...calleeLines);
	}

	lines.push("---", ctx.source);

	return lines.join("\n");
}

export function renderImports(imports: ImportInfo[]): string {
	if (imports.length === 0) {
		return "(no imports)";
	}

	return imports
		.map((i) => {
			const parts = [i.module];

			if (i.named.length > 0) {
				parts.push(i.named.join(", "));
			}

			if (i.default !== undefined) {
				parts.push(`default ${i.default}`);
			}

			if (i.namespace !== undefined) {
				parts.push(`* as ${i.namespace}`);
			}

			return parts.join("\t");
		})
		.join("\n");
}

export function renderUsageReport(rows: UsageReportEntry[]): string {
	if (rows.length === 0) {
		return "(no exports)";
	}

	return rows.map((r) => `${r.qualifiedName}\ttotal=${r.total} consumed=${r.consumed}\t${r.kind}`).join("\n");
}
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Export + commit** — add the four to `index.ts`, then:

```bash
git add packages/core/src/render.ts packages/core/src/index.ts packages/core/src/__tests__/render.test.ts
git commit -m "Add context/callHierarchy/imports/usageReport renderers"
```

---

## Task 4: CLI — text default + --json per command

**Files:**

- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/__tests__/cli.test.ts`

Read `packages/cli/src/index.ts` first. It has `emit(value)` (JSON), `print(text)`, `withEngine`, and each command. Replace the per-command `emit(...)` with an `output(...)` that switches on a `--json` flag.

- [ ] **Step 1: Write failing tests** — add to `cli.test.ts` (reuse its `run()` helper):

```typescript
test("find refs prints address-first text by default", async () => {
	const { code, stdout } = await run(["find", "refs", "--tsconfig", TSCONFIG, "src/shapes.ts:makeCircle"]);
	expect(code).toBe(0);
	expect(stdout).toMatch(/src\/consumer\.ts:\d+:\d+\t/); // addr<TAB>kind, not JSON
	expect(stdout).not.toContain("{"); // no JSON braces
});

test("find refs --json prints structured JSON", async () => {
	const { code, stdout } = await run(["find", "refs", "--tsconfig", TSCONFIG, "src/shapes.ts:makeCircle", "--json"]);
	expect(code).toBe(0);
	const parsed = JSON.parse(stdout) as { references: unknown[] };
	expect(Array.isArray(parsed.references)).toBe(true);
});

test("view symbol prints source verbatim (no escaped newlines) by default", async () => {
	const { code, stdout } = await run(["view", "symbol", "--tsconfig", TSCONFIG, "src/shapes.ts:makeCircle"]);
	expect(code).toBe(0);
	expect(stdout).toContain("export function makeCircle");
	expect(stdout).not.toContain("\\n"); // real newlines, not escaped
});
```

(The existing `view outline` text test stays valid. Update the old `resolve returns JSON kind:symbol` tests: by default `resolve` now prints text — change them to add `--json`, OR assert the text line `src/shapes.ts:makeCircle\tL12`. Pick the text assertion for the default test + keep one `--json` test.)

- [ ] **Step 2: Run, verify FAIL** (default still emits JSON).

- [ ] **Step 3: Add the `--json` arg + `output` helper.** In `packages/cli/src/index.ts`:

Add to the shared args (beside `engine`):

```typescript
const json = { type: "boolean", description: "Emit structured JSON instead of text" } as const;
```

Add the helper (replaces bare `emit` at call sites):

```typescript
import {} from /* existing */ "@kestrel/core";
// add the render imports:
import {
	renderResolve,
	renderReferences,
	renderHandles,
	renderCandidates,
	renderSource,
	renderRegion,
	renderMembers,
	renderStatements,
	renderContext,
	renderCallHierarchy,
	renderImports,
	renderUsageReport,
	renderFileOutline
} from "@kestrel/core";

/** Print text via `render` by default, or pretty JSON of `value` when args.json is set. */
function output(value: unknown, render: () => string, jsonFlag: boolean | undefined): void {
	if (jsonFlag === true) {
		process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
	} else {
		process.stdout.write(`${render()}\n`);
	}
}
```

Then each command passes the struct + its renderer. Examples:

```typescript
// resolve
await withEngine(args, async (e) => {
	const r = await e.resolveSymbol(args.symbol);
	output(r, () => renderResolve(r), args.json);
});

// find refs
const usages = await e.findUsages(symbol, { ... });
output(usages, () => renderReferences(usages), args.json);

// find def / impls
const handles = await e.findDefinition(symbol);
output(handles, () => renderHandles(handles), args.json);

// find symbol
const cands = await e.searchSymbol(args.name, { contains: args.contains });
output(cands, () => renderCandidates(cands), args.json);

// find callers / callees
const tree = await e.callHierarchy(symbol, { ... });
output(tree, () => renderCallHierarchy(tree), args.json);

// view symbol
const src = await e.symbolSource(symbol);
output(src, () => renderSource(src), args.json);

// view region
const region = await e.readRegion(m[1]!, Number(m[2]), Number(m[3]));
output(region, () => renderRegion(region), args.json);

// view members
const members = await e.outlineSymbol(symbol);
output(members, () => renderMembers(members), args.json);

// view body
const stmts = await e.outlineFunction(symbol, { depth });
output(stmts, () => renderStatements(stmts), args.json);

// view context
const ctx = await e.symbolContext(symbol);
output(ctx, () => renderContext(ctx), args.json);

// imports
const imps = await e.listImports(args.file);
output(imps, () => renderImports(imps), args.json);

// exports (publicSurface → candidates)
const surf = await e.publicSurface(args.file);
output(surf, () => renderCandidates(surf), args.json);

// usage
const report = await e.usageReport(args.file, { ... });
output(report, () => renderUsageReport(report), args.json);
```

Add `json` to every command's `args`. For `view outline`: it already has `--json` meaning "full struct"; keep that — it prints the tree by default and the struct under `--json` (the new uniform behavior; drop its old bespoke `json` handling in favor of `output(outline, () => renderFileOutline(args.file, outline), args.json)`). Remove the now-unused `emit`/`print` if nothing else uses them (keep `print` only if still referenced).

- [ ] **Step 4: Run, verify PASS** — `pnpm build`, `pnpm exec nadle test`. Confirm: default text, `--json` struct, `view outline` still a tree.

- [ ] **Step 5: Smoke**

```bash
node ./packages/cli/dist/index.js find refs --tsconfig packages/core/src/__tests__/fixtures/sample/tsconfig.json src/shapes.ts:makeCircle
node ./packages/cli/dist/index.js view context --tsconfig packages/core/src/__tests__/fixtures/sample/tsconfig.json src/consumer.ts:totalArea
```

Expected: dense text rows / labeled context. Paste both.

- [ ] **Step 6: Check + commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/__tests__/cli.test.ts
git commit -m "CLI: text output by default, --json opt-in"
```

---

## Task 5: MCP — text default + json arg per tool

**Files:**

- Modify: `packages/mcp/src/index.ts`
- Test: `packages/mcp/src/__tests__/mcp.test.ts`

Read `packages/mcp/src/index.ts`. It has `json(value)` (pretty-JSON `ToolResult`), `text(value)`, `resolveOr`, and the `tool(names, schema, handler)` helper. Add a `json` arg to each tool's schema and return rendered text by default.

- [ ] **Step 1: Write failing tests** — add to `mcp.test.ts` (reuse the `McpClient`):

```typescript
it("tools/call find_refs returns text by default", async () => {
	const result = (await client.request("tools/call", {
		name: "find_refs",
		arguments: { tsConfig: TSCONFIG, symbol: "src/shapes.ts:makeCircle" }
	})) as { content: { type: string; text: string }[] };
	expect(result.content[0]!.text).toMatch(/src\/consumer\.ts:\d+:\d+\t/);
	expect(result.content[0]!.text).not.toContain("{");
}, 20_000);

it("tools/call find_refs with json:true returns JSON", async () => {
	const result = (await client.request("tools/call", {
		name: "find_refs",
		arguments: { tsConfig: TSCONFIG, symbol: "src/shapes.ts:makeCircle", json: true }
	})) as { content: { type: string; text: string }[] };
	const parsed = JSON.parse(result.content[0]!.text) as { references: unknown[] };
	expect(Array.isArray(parsed.references)).toBe(true);
}, 20_000);
```

(Update the existing `view_symbol returns the declaration source` test — it asserts `.toContain("makeCircle")`, still true for text; fine. The `resolve` test asserts JSON `kind:symbol` — change it to `json: true` in its arguments, or assert the text line.)

- [ ] **Step 2: Run, verify FAIL** (default still JSON).

- [ ] **Step 3: Add a `json` arg + a `render(value, renderer, jsonFlag)` helper.** In `packages/mcp/src/index.ts`:

Add the render imports from `@kestrel/core` (same list as the CLI). Add:

```typescript
const jsonArg = z.boolean().optional().describe("Return structured JSON instead of text");

/** Text content by default, or pretty JSON when jsonFlag is set. */
function out(value: unknown, rendered: string, jsonFlag: boolean | undefined): ToolResult {
	return jsonFlag === true ? json(value) : text(rendered);
}
```

Add `json: jsonArg` to every tool's `inputSchema`, thread `json` into each handler, and wrap the result. Examples:

```typescript
// resolve
async ({ symbol, engine, json: j, tsConfig: tc }) => {
	const r = await engineFor(tc, kindOf(engine)).resolveSymbol(symbol!);
	return out(r, renderResolve(r), j);
}

// find_refs (via resolveOr → but resolveOr may return a ResolveResult on not-found)
async ({ symbol, engine, json: j, tsConfig: tc, ... }) => {
	const r = await resolveOr(tc, kindOf(engine), symbol!, (e, s) => e.findUsages(s, { ... }));
	// r is UsagesResult | ResolveResult; render accordingly:
	return out(r, isResolveResult(r) ? renderResolve(r) : renderReferences(r as UsagesResult), j);
}
```

Add a small guard `isResolveResult(x): x is ResolveResult` (checks `x && typeof x === "object" && "kind" in x && (x.kind === "not-found" || x.kind === "ambiguous")`) — used wherever a tool goes through `resolveOr`, since that returns the resolve result on miss. For non-`resolveOr` tools (imports, exports, usage_report, view_region, find_symbol) render directly. For `view_outline` keep its tree (`renderFileOutline`) as the text branch; the `full` arg already meant JSON — fold `full` into the `json` arg (drop `full`, use `json`).

- [ ] **Step 4: Run, verify PASS** — `pnpm build`, `pnpm exec nadle test` (the tools/list test still passes; the resolve/view_symbol tests updated).

- [ ] **Step 5: Check + commit**

```bash
git add packages/mcp/src/index.ts packages/mcp/src/__tests__/mcp.test.ts
git commit -m "MCP: text output by default, json arg opt-in"
```

---

## Task 6: README + close #72 + verify

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Update README** — note that all commands print token-lean text by default with `--json` (CLI) / `json: true` (MCP) for structured output; update any example that implied JSON output. Add one line: "Output is address-first text — paste `file:line:col` or `file:Name` straight into the next query."

- [ ] **Step 2: Full verification**

```bash
pnpm build
KESTREL_REQUIRE_LSP=1 pnpm exec nadle testCoverage
pnpm exec nadle check
```

Expected: all pass; coverage thresholds hold (render.ts is pure + fully tested).

- [ ] **Step 3: Commit + push + PR**

```bash
git add README.md
git commit -m "Document text-by-default output"
git push -u origin feat/text-output
```

Open a PR titled "Token-lean text output by default" summarizing the new format + `--json` escape; body notes it Closes #72 (the `--text` flag is obsolete — text is the default now). Let CI run all three OS.

---

## Self-review notes

- **Spec coverage:** every op's renderer (T1 rows, T2 source/region/members/statements, T3 context/calls/imports/usageReport) ✓; CLI text-default + --json (T4) ✓; MCP text-default + json arg (T5) ✓; address-first rule (location ops use `addr()` = file:line:col; symbol ops use qualifiedName) ✓; real newlines in source (renderSource/renderRegion emit `\n` literally) ✓; trees indent 2 spaces (renderStatements/renderCallHierarchy) ✓; render.ts in core, adapters call (T4/T5) ✓; #72 closed (T6) ✓.
- **Type consistency:** renderer names + signatures identical across render.ts, index.ts exports, CLI imports, MCP imports. Structs (`UsagesResult`, `Candidate`, `SymbolHandle`, `SourceResult`, `RegionResult`, `Member`, `StatementNode`, `SymbolContext`, `CallNode`, `ImportInfo`, `UsageReportEntry`, `ResolveResult`) are the existing core types, unchanged.
- **Placeholder fix applied:** Task 1 Step 3 flags + corrects the refs-row double-`(test)`; the implementer builds parts via the spread form `[addr(pos), kind, ...(context!==undefined?[context]:[]), ...(test===true?["(test)"]:[])].join("\t")`.
- **MCP resolveOr nuance** called out explicitly (a missed resolve returns a ResolveResult, not the op result) with the `isResolveResult` guard — prevents rendering a not-found as references.
- **YAGNI:** no color, no config, one `--json` escape; `full` folded into `json` for view_outline; supersedes the #72 flag.
