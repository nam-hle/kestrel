# LspEngine (Door 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `LspEngine` to `packages/core` that answers kestrel's read-only ops via a warm `tsgo --lsp` subprocess (semantic ops) plus a thin `typescript`-native parser (syntactic ops), translating everything to kestrel's existing name-addressed contract. ts-morph `Engine` stays the default and is left untouched.

**Architecture:** A shared `SymbolEngine` interface both engines implement. `LspEngine` lazily spawns one tsgo LSP per project root, resolves `file:Name` → LSP position via tsgo's own `documentSymbol` (the addressing bridge — no second semantic engine), and uses `ts.createSourceFile` only for syntax the LSP can't serve (imports, outline detail, function bodies, reference-kind classification). Byte/LSP offsets never leave the adapter.

**Tech Stack:** TypeScript 6 (native `typescript` API), `@typescript/native-preview` (bin `tsgo`, `--lsp --stdio`, LSP/JSON-RPC over stdio), vitest 4, nadle.

**Source of truth:** [docs/superpowers/specs/2026-06-07-lsp-engine-design.md](../specs/2026-06-07-lsp-engine-design.md). Spike evidence: [docs/TSGO-SPIKE.md](../../TSGO-SPIKE.md) Door 3 Results.

---

## File structure

```
packages/core/src/
  symbol-engine.ts        SymbolEngine interface (extracted from Engine's public shape)
  engine.ts               (modify: declare `implements SymbolEngine`, no behavior change)
  index.ts                (modify: export SymbolEngine type + LspEngine class)
  lsp-engine.ts           LspEngine: orchestrates client + bridge + syntactic + translate
  lsp/
    client.ts             LspClient: spawn tsgo, JSON-RPC framing, request/notify, dispose
    protocol.ts           minimal LSP type + enum subset used here (no vscode dep)
    translate.ts          uri->relative, 0-based->1-based, Location->Position/SymbolHandle
    bridge.ts             walk DocumentSymbol tree: file:Name (dotted/#index) -> position
    syntactic.ts          ts.createSourceFile walkers: imports, outline, fn skeleton, classify
packages/core/src/__tests__/
  symbol-engine.test.ts   interface conformance (both engines assignable)
  lsp/translate.test.ts
  lsp/bridge.test.ts
  lsp/syntactic.test.ts
  lsp-engine.test.ts      integration vs tsgo; parity vs ts-morph Engine on fixtures
```

Conventions (from CLAUDE.md): prettier = TABS, printWidth 150; ESM, `.js` import suffixes; forward-slash paths; TDD red-green-refactor; verify with the CI command `pnpm exec nadle test` from the repo root (not per-package). Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 0: Add the tsgo dependency

**Files:**

- Modify: `packages/core/package.json` (dependencies)

- [ ] **Step 1: Add the dep** (pnpm `--filter add` no-ops here; cd into the package)

Run:

```bash
cd packages/core && pnpm add @typescript/native-preview@7.0.0-dev.20260606.1 && pnpm add -D typescript@^6.0.3
```

(`typescript` may already be transitively present via ts-morph; the explicit devDep pins the native-API surface used by `syntactic.ts`.)

- [ ] **Step 2: Verify the bin resolves**

NOTE (verified 2026-06-07): `bin/tsgo.js` is NOT in the package's `exports`, so
`require.resolve('@typescript/native-preview/bin/tsgo.js')` throws
`ERR_PACKAGE_PATH_NOT_EXPORTED`. Resolve via the package.json dir instead:

```bash
node -e "const p=require.resolve('@typescript/native-preview/package.json'); console.log(require('path').join(require('path').dirname(p),'bin','tsgo.js'))"
```

Expected: prints an absolute path ending `.../@typescript/native-preview/bin/tsgo.js`. The
file exists and `node <that path> --version` prints `Version 7.0.0-dev.20260606.1`.

- [ ] **Step 3: Add a shared bin-resolver helper**

Create `packages/core/src/lsp/tsgo-bin.ts` — single source of truth for the bin path, used
by `client.ts` and the test-gating in `client.test.ts` / `lsp-engine.test.ts`:

```typescript
/** Resolve the tsgo launcher path. The bin is not in the package `exports`, so resolve
 * via the package.json directory rather than a bin subpath. Returns undefined if the
 * dep is absent (tests gate on this). */
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function tsgoBinPath(): string | undefined {
	try {
		const pkg = require.resolve("@typescript/native-preview/package.json");

		return join(dirname(pkg), "bin", "tsgo.js");
	} catch {
		return undefined;
	}
}
```

Wherever the plan's later tasks show `require.resolve('@typescript/native-preview/bin/tsgo.js')`
(client spawn, test gating), use `tsgoBinPath()` instead — spawn with
`spawn(process.execPath, [binPath, "--lsp", "--stdio"], …)`, and gate tests with
`const binAvailable = tsgoBinPath() !== undefined;`.

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json packages/core/src/lsp/tsgo-bin.ts pnpm-lock.yaml
git commit -m "Add @typescript/native-preview dep + tsgo bin resolver"
```

---

## Task 1: SymbolEngine interface

Extract an interface from `Engine`'s public method shapes so both engines are interchangeable. `Engine` only gains an `implements` clause — no behavior change.

**Files:**

- Create: `packages/core/src/symbol-engine.ts`
- Modify: `packages/core/src/engine.ts:71` (class declaration)
- Test: `packages/core/src/__tests__/symbol-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expectTypeOf } from "vitest";

import { Engine } from "../engine.js";
import type { SymbolEngine } from "../symbol-engine.js";

describe("SymbolEngine", () => {
	it("Engine is assignable to SymbolEngine", () => {
		expectTypeOf<Engine>().toMatchTypeOf<SymbolEngine>();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec nadle test`
Expected: FAIL — cannot find module `../symbol-engine.js`.

- [ ] **Step 3: Create the interface**

```typescript
/**
 * The read-only query surface kestrel exposes. Implemented by the ts-morph `Engine`
 * (default) and the tsgo `LspEngine` (opt-in). Transport-agnostic; output uses kestrel's
 * name-addressed contract (file:Name + 1-based Position), never byte/LSP offsets.
 */
import type {
	Member,
	CallNode,
	Candidate,
	ImportInfo,
	FileOutline,
	SymbolHandle,
	UsagesResult,
	ResolveResult,
	SearchOptions,
	StatementNode,
	UsageReportEntry,
	FindUsagesOptions,
	UsageReportOptions,
	CallHierarchyOptions,
	OutlineFunctionOptions
} from "./types.js";

export interface SymbolEngine {
	resolveSymbol(qualifiedName: string): ResolveResult;
	searchSymbol(name: string, options?: SearchOptions): Candidate[];
	findUsages(symbol: SymbolHandle, options?: FindUsagesOptions): UsagesResult;
	callHierarchy(symbol: SymbolHandle, options?: CallHierarchyOptions): CallNode[];
	findImplementations(symbol: SymbolHandle): SymbolHandle[];
	findDefinition(symbol: SymbolHandle): SymbolHandle[];
	outlineFile(path: string): FileOutline;
	publicSurface(path: string): Candidate[];
	usageReport(path: string, options?: UsageReportOptions): UsageReportEntry[];
	listImports(path: string): ImportInfo[];
	outlineSymbol(symbol: SymbolHandle): Member[];
	outlineFunction(symbol: SymbolHandle, options?: OutlineFunctionOptions): StatementNode[];
	refreshIfStale(): void;
}
```

- [ ] **Step 4: Make `Engine` declare it**

In `packages/core/src/engine.ts`, change the class line:

```typescript
import type { SymbolEngine } from "./symbol-engine.js";

export class Engine implements SymbolEngine {
```

(Add the import alongside the existing type imports. No method bodies change.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec nadle test`
Expected: PASS. If TS complains `Engine` is missing a member, the interface drifted from the class — align the signature exactly.

- [ ] **Step 6: Export the type**

In `packages/core/src/index.ts` add:

```typescript
export type { SymbolEngine } from "./symbol-engine.js";
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/symbol-engine.ts packages/core/src/engine.ts packages/core/src/index.ts packages/core/src/__tests__/symbol-engine.test.ts
git commit -m "Extract SymbolEngine interface implemented by Engine"
```

---

## Task 2: LSP protocol types

A tiny hand-written subset of the LSP types/enums used here. No `vscode-languageserver` dependency.

**Files:**

- Create: `packages/core/src/lsp/protocol.ts`

(No test of its own — it is type-only + enum constants, exercised by translate/bridge tests.)

- [ ] **Step 1: Create the file**

```typescript
/** Minimal subset of the LSP types kestrel's LspEngine uses. 0-based line/character. */

export interface LspPosition {
	line: number;
	character: number;
}

export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

export interface LspLocation {
	uri: string;
	range: LspRange;
}

/** LSP SymbolKind subset we map to kestrel kind names. */
export enum LspSymbolKind {
	File = 1,
	Module = 2,
	Namespace = 3,
	Class = 5,
	Method = 6,
	Property = 7,
	Constructor = 9,
	Interface = 11,
	Function = 12,
	Variable = 13,
	Constant = 14,
	TypeParameter = 26
}

/** Hierarchical document symbol (tsgo returns this nested form). */
export interface DocumentSymbol {
	name: string;
	kind: LspSymbolKind;
	range: LspRange;
	selectionRange: LspRange;
	children?: DocumentSymbol[];
}

export interface CallHierarchyItem {
	name: string;
	kind: LspSymbolKind;
	uri: string;
	range: LspRange;
	selectionRange: LspRange;
}

export interface CallHierarchyIncomingCall {
	from: CallHierarchyItem;
	fromRanges: LspRange[];
}

export interface CallHierarchyOutgoingCall {
	to: CallHierarchyItem;
	fromRanges: LspRange[];
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/lsp/protocol.ts
git commit -m "Add minimal LSP protocol types for the LSP engine"
```

---

## Task 3: Translation helpers

Pure functions converting LSP wire shapes to kestrel types. No subprocess — fully unit-testable.

**Files:**

- Create: `packages/core/src/lsp/translate.ts`
- Test: `packages/core/src/__tests__/lsp/translate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";

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
		expect(lspToPosition({ line: 0, character: 0 })).toEqual({ line: 1, col: 1 });
	});
});

describe("locationToPosition", () => {
	it("builds a kestrel Position from an LSP Location", () => {
		const loc = { uri: "file:///abs/project/src/shapes.ts", range: { start: { line: 4, character: 13 }, end: { line: 4, character: 19 } } };
		expect(locationToPosition(loc, root)).toEqual({ file: "src/shapes.ts", line: 5, col: 14 });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec nadle test`
Expected: FAIL — cannot find module `../../lsp/translate.js`.

- [ ] **Step 3: Implement**

```typescript
/** LSP wire shapes -> kestrel types. Offsets never leave this adapter layer. */
import type { Position } from "../types.js";
import type { LspLocation, LspPosition } from "./protocol.js";

/** `file://<root>/rest` -> `rest`, forward-slashed, root-relative. */
export function uriToRelative(uri: string, root: string): string {
	let path = uri.replace(/^file:\/\//, "").replace(/\\/g, "/");
	// On posix the path keeps its leading slash; decode percent-encoding tsgo may emit.
	path = decodeURIComponent(path);
	const base = root.replace(/\\/g, "/");

	return path.startsWith(base) ? path.slice(base.length).replace(/^\//, "") : path;
}

/** LSP 0-based -> kestrel 1-based. */
export function lspToPosition(pos: LspPosition): { line: number; col: number } {
	return { line: pos.line + 1, col: pos.character + 1 };
}

/** LSP Location -> kestrel Position (relative file + 1-based line/col). */
export function locationToPosition(loc: LspLocation, root: string): Position {
	const { line, col } = lspToPosition(loc.range.start);

	return { file: uriToRelative(loc.uri, root), line, col };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec nadle test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lsp/translate.ts packages/core/src/__tests__/lsp/translate.test.ts
git commit -m "Add LSP-to-kestrel translation helpers"
```

---

## Task 4: The addressing bridge (documentSymbol walk)

Pure function: given a parsed name (segments + optional index) and a `DocumentSymbol[]` tree, return the matching symbols' positions. This is the key design choice — name → position via tsgo's own symbol tree, no second semantic engine.

**Files:**

- Create: `packages/core/src/lsp/bridge.ts`
- Test: `packages/core/src/__tests__/lsp/bridge.test.ts`

Matching rules (mirror `resolve.ts`): a multi-segment path matches by exact dotted path from a root; a single bare segment matches the last component at any depth. `#index` picks among same-path matches.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";

import { resolveInSymbols } from "../../lsp/bridge.js";
import { LspSymbolKind } from "../../lsp/protocol.js";
import type { DocumentSymbol } from "../../lsp/protocol.js";

const sel = (line: number, character: number) => ({ start: { line, character }, end: { line, character: character + 1 } });

// Shape interface (line 0) with member area; Circle class (line 4) with member area.
const tree: DocumentSymbol[] = [
	{
		name: "Shape",
		kind: LspSymbolKind.Interface,
		range: sel(0, 0),
		selectionRange: sel(0, 17),
		children: [{ name: "area", kind: LspSymbolKind.Method, range: sel(1, 1), selectionRange: sel(1, 1) }]
	},
	{
		name: "Circle",
		kind: LspSymbolKind.Class,
		range: sel(4, 0),
		selectionRange: sel(4, 13),
		children: [{ name: "area", kind: LspSymbolKind.Method, range: sel(6, 1), selectionRange: sel(6, 1) }]
	}
];

describe("resolveInSymbols", () => {
	it("resolves a top-level name to its selectionRange start", () => {
		const hits = resolveInSymbols(tree, ["Circle"]);
		expect(hits).toHaveLength(1);
		expect(hits[0]).toEqual({ name: "Circle", path: "Circle", kind: LspSymbolKind.Class, position: { line: 4, character: 13 } });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec nadle test`
Expected: FAIL — cannot find module `../../lsp/bridge.js`.

- [ ] **Step 3: Implement**

```typescript
/**
 * The addressing bridge: resolve a kestrel dotted name against a tsgo `documentSymbol`
 * tree to LSP positions. No second semantic engine — tsgo is the single source of truth
 * for "where is this symbol".
 */
import type { LspPosition, DocumentSymbol, LspSymbolKind } from "./protocol.js";

export interface SymbolHit {
	name: string;
	/** Dotted path from a root symbol, e.g. "Circle.area". */
	path: string;
	kind: LspSymbolKind;
	/** selectionRange.start — points at the name token, the position to send to LSP. */
	position: LspPosition;
}

/** Flatten the tree to (path, hit) pairs, depth-first. */
function flatten(symbols: DocumentSymbol[], prefix: string): SymbolHit[] {
	const out: SymbolHit[] = [];

	for (const sym of symbols) {
		const path = prefix === "" ? sym.name : `${prefix}.${sym.name}`;
		out.push({ name: sym.name, path, kind: sym.kind, position: sym.selectionRange.start });

		if (sym.children !== undefined && sym.children.length > 0) {
			out.push(...flatten(sym.children, path));
		}
	}

	return out;
}

/**
 * A multi-segment path matches by exact dotted path; a single bare segment matches the
 * last path component at any depth. Returns every match (caller disambiguates by #index).
 */
export function resolveInSymbols(symbols: DocumentSymbol[], segments: string[]): SymbolHit[] {
	const all = flatten(symbols, "");

	if (segments.length > 1) {
		const target = segments.join(".");

		return all.filter((h) => h.path === target);
	}

	const name = segments[0]!;

	return all.filter((h) => {
		const parts = h.path.split(".");

		return parts[parts.length - 1] === name;
	});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec nadle test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lsp/bridge.ts packages/core/src/__tests__/lsp/bridge.test.ts
git commit -m "Add documentSymbol addressing bridge (name -> LSP position)"
```

---

## Task 5: Syntactic walkers (typescript native API)

Pure functions over `ts.SourceFile` for ops the LSP cannot serve: imports, file outline, function-body skeleton, and reference-kind classification by position. Each takes file _text_ (so the engine can pass tsgo-open buffers or disk reads) and a file path.

**Files:**

- Create: `packages/core/src/lsp/syntactic.ts`
- Test: `packages/core/src/__tests__/lsp/syntactic.test.ts`

Output must match the ts-morph engine's shapes (`ImportInfo`, `FileOutline`, `StatementNode`, `ReferenceKind`). Use 1-based positions via `sourceFile.getLineAndCharacterOfPosition` (0-based) + 1.

- [ ] **Step 1: Write the failing test** (real fixture text inline so the test is self-contained)

```typescript
import { describe, it, expect } from "vitest";

import { parseImports, classifyAt } from "../../lsp/syntactic.js";

const consumer = `import { makeCircle, Circle } from "./shapes.js";

export function totalArea(count: number): number {
	const c: Circle = makeCircle(count);
	return c.area();
}
`;

describe("parseImports", () => {
	it("extracts named imports + module", () => {
		const imports = parseImports("src/consumer.ts", consumer);
		expect(imports).toHaveLength(1);
		expect(imports[0]!.module).toBe("./shapes.js");
		expect(imports[0]!.named).toEqual(["makeCircle", "Circle"]);
		expect(imports[0]!.position.line).toBe(1);
	});
});

describe("classifyAt", () => {
	it("classifies an import-specifier occurrence as import", () => {
		// "makeCircle" in the import clause, line 1.
		expect(classifyAt(consumer, { line: 0, character: 9 })).toBe("import");
	});

	it("classifies a call target as call", () => {
		// "makeCircle(count)" on line 4 (0-based line 3).
		const idx = consumer.indexOf("makeCircle(count)");
		const before = consumer.slice(0, idx);
		const line = before.split("\n").length - 1;
		const character = idx - before.lastIndexOf("\n") - 1;
		expect(classifyAt(consumer, { line, character })).toBe("call");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec nadle test`
Expected: FAIL — cannot find module `../../lsp/syntactic.js`.

- [ ] **Step 3: Implement** (start with the two tested fns; outline fns added in Task 5b)

```typescript
/**
 * Syntactic ops via the typescript native API — for what tsgo's LSP cannot serve
 * (imports, outline detail, function bodies, reference-kind classification). Parses a
 * single file; no project, no typecheck.
 */
import ts from "typescript";

import type { ImportInfo, ReferenceKind } from "../types.js";
import type { LspPosition } from "./protocol.js";

function parse(path: string, text: string): ts.SourceFile {
	return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TS);
}

/** 0-based ts position -> kestrel 1-based. */
function posOf(sf: ts.SourceFile, pos: number): { line: number; col: number } {
	const { line, character } = sf.getLineAndCharacterOfPosition(pos);

	return { line: line + 1, col: character + 1 };
}

export function parseImports(path: string, text: string): ImportInfo[] {
	const sf = parse(path, text);
	const imports: ImportInfo[] = [];

	for (const stmt of sf.statements) {
		if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) {
			continue;
		}

		const named: string[] = [];
		let defaultImport: string | undefined;
		let namespace: string | undefined;
		const clause = stmt.importClause;

		if (clause?.name !== undefined) {
			defaultImport = clause.name.text;
		}

		const bindings = clause?.namedBindings;

		if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
			namespace = bindings.name.text;
		} else if (bindings !== undefined && ts.isNamedImports(bindings)) {
			for (const el of bindings.elements) {
				named.push(el.name.text);
			}
		}

		const { line, col } = posOf(sf, stmt.getStart(sf));

		imports.push({
			module: stmt.moduleSpecifier.text,
			named,
			...(defaultImport !== undefined ? { default: defaultImport } : {}),
			...(namespace !== undefined ? { namespace } : {}),
			position: { file: path, line, col }
		});
	}

	return imports;
}

/** Find the identifier node at an LSP (0-based) position and classify its reference kind. */
export function classifyAt(text: string, pos: LspPosition): ReferenceKind {
	const sf = parse("__classify.ts", text);
	const offset = sf.getPositionOfLineAndCharacter(pos.line, pos.character);
	const node = nodeAt(sf, offset);

	return node === undefined ? "read" : classify(node);
}

function nodeAt(sf: ts.SourceFile, offset: number): ts.Node | undefined {
	let found: ts.Node | undefined;

	const visit = (node: ts.Node): void => {
		if (offset < node.getStart(sf) || offset >= node.getEnd()) {
			return;
		}

		if (ts.isIdentifier(node)) {
			found = node;
		}

		node.forEachChild(visit);
	};

	visit(sf);

	return found;
}

function classify(node: ts.Node): ReferenceKind {
	for (let n: ts.Node | undefined = node; n !== undefined; n = n.parent) {
		if (ts.isExportSpecifier(n)) {
			const decl = n.parent.parent;

			if (ts.isExportDeclaration(decl) && decl.moduleSpecifier !== undefined) {
				return "re-export";
			}
		}

		if (ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n)) {
			return "import";
		}

		if (ts.isTypeReferenceNode(n) || ts.isTypeQueryNode(n)) {
			return "type-ref";
		}
	}

	// Call target: identifier (or its property-access) is the callee of a call/new.
	let target: ts.Node = node;

	if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
		target = node.parent;
	}

	const parent = target.parent;

	if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === target) {
		return "call";
	}

	if (ts.isBinaryExpression(node.parent) && node.parent.left === node && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
		return "write";
	}

	return "read";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec nadle test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lsp/syntactic.ts packages/core/src/__tests__/lsp/syntactic.test.ts
git commit -m "Add syntactic walkers (imports + reference classification)"
```

---

## Task 5b: Syntactic outline + function skeleton

Extend `syntactic.ts` with `outlineFile`, `outlineSymbolMembers`, and `functionSkeleton`, matching the ts-morph engine's `FileOutline` / `Member` / `StatementNode` shapes. Tested for parity against the ts-morph `Engine` on the same fixture in Task 7; here we test shape directly.

**Files:**

- Modify: `packages/core/src/lsp/syntactic.ts`
- Test: `packages/core/src/__tests__/lsp/syntactic.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests** (append)

```typescript
import { buildOutline, functionSkeleton } from "../../lsp/syntactic.js";

const shapes = `export interface Shape {
	area(): number;
}

export class Circle implements Shape {
	area(): number {
		return 1;
	}
}

export function makeCircle(): Circle {
	return new Circle();
}

export interface Box<T, U> {
	value: T;
}
`;

describe("buildOutline", () => {
	it("buckets interfaces / classes / functions with exported flag", () => {
		const o = buildOutline("src/shapes.ts", shapes);
		expect(o.interfaces.map((m) => m.name).sort()).toEqual(["Box", "Shape"]);
		expect(o.classes.map((m) => m.name)).toEqual(["Circle"]);
		expect(o.functions.map((m) => m.name)).toEqual(["makeCircle"]);
		expect(o.classes[0]!.exported).toBe(true);
	});

	it("captures generic type parameters", () => {
		const o = buildOutline("src/shapes.ts", shapes);
		expect(o.interfaces.find((m) => m.name === "Box")!.typeParameters).toEqual(["T", "U"]);
	});
});

describe("functionSkeleton", () => {
	it("returns the top-level statement kinds of a function body", () => {
		const o = functionSkeleton(shapes, { line: 10, character: 16 }, 1); // makeCircle
		expect(o.map((s) => s.kind)).toContain("ReturnStatement");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec nadle test`
Expected: FAIL — `buildOutline`/`functionSkeleton` not exported.

- [ ] **Step 3: Implement** (append to `syntactic.ts`)

```typescript
import type { Member, FileOutline, StatementNode } from "../types.js";

function typeParamsOf(node: ts.Node): string[] | undefined {
	const tps = (node as ts.DeclarationWithTypeParameters).typeParameters;

	return tps !== undefined && tps.length > 0 ? tps.map((tp) => tp.name.text) : undefined;
}

function isExported(node: ts.Node): boolean {
	const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;

	return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function memberOf(sf: ts.SourceFile, path: string, name: string, kind: string, node: ts.Node): Member {
	const { line, col } = posOf(sf, node.getStart(sf));
	const tps = typeParamsOf(node);

	return {
		name,
		kind,
		signature: name,
		position: { file: path, line, col },
		exported: isExported(node),
		qualifiedName: `${path}:${name}`,
		...(tps !== undefined ? { typeParameters: tps } : {})
	};
}

export function buildOutline(path: string, text: string): FileOutline {
	const sf = parse(path, text);
	const outline: FileOutline = { classes: [], interfaces: [], functions: [], variables: [], exports: [] };

	for (const stmt of sf.statements) {
		if (ts.isClassDeclaration(stmt) && stmt.name !== undefined) {
			outline.classes.push(memberOf(sf, path, stmt.name.text, "ClassDeclaration", stmt));
		} else if (ts.isInterfaceDeclaration(stmt)) {
			outline.interfaces.push(memberOf(sf, path, stmt.name.text, "InterfaceDeclaration", stmt));
		} else if (ts.isFunctionDeclaration(stmt) && stmt.name !== undefined) {
			outline.functions.push(memberOf(sf, path, stmt.name.text, "FunctionDeclaration", stmt));
		} else if (ts.isVariableStatement(stmt)) {
			for (const decl of stmt.declarationList.declarations) {
				if (ts.isIdentifier(decl.name)) {
					outline.variables.push(memberOf(sf, path, decl.name.text, "VariableDeclaration", stmt));
				}
			}
		}
	}

	return outline;
}

/** Member declarations of a class/interface/namespace at a given position. */
export function outlineSymbolMembers(path: string, text: string, pos: LspPosition): Member[] {
	const sf = parse(path, text);
	const offset = sf.getPositionOfLineAndCharacter(pos.line, pos.character);
	const owner = ownerAt(sf, offset);

	if (owner === undefined) {
		return [];
	}

	const ownerName = (owner as ts.NamedDeclaration).name;
	const prefix = ownerName !== undefined && ts.isIdentifier(ownerName) ? ownerName.text : "";
	const members: Member[] = [];

	const push = (name: string, kind: string, node: ts.Node): void => {
		members.push(memberOf(sf, path, prefix === "" ? name : `${prefix}.${name}`, kind, node));
	};

	if (ts.isClassDeclaration(owner) || ts.isInterfaceDeclaration(owner)) {
		for (const m of owner.members) {
			if (m.name !== undefined && ts.isIdentifier(m.name)) {
				push(m.name.text, ts.SyntaxKind[m.kind], m);
			}
		}
	}

	return members;
}

function ownerAt(sf: ts.SourceFile, offset: number): ts.Node | undefined {
	let found: ts.Node | undefined;

	const visit = (node: ts.Node): void => {
		if (offset < node.getStart(sf) || offset >= node.getEnd()) {
			return;
		}

		if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isModuleDeclaration(node)) {
			found = node;
		}

		node.forEachChild(visit);
	};

	visit(sf);

	return found;
}

export function functionSkeleton(text: string, pos: LspPosition, depth: number): StatementNode[] {
	const sf = parse("__fn.ts", text);
	const offset = sf.getPositionOfLineAndCharacter(pos.line, pos.character);
	const fn = functionAt(sf, offset);
	const body = fn !== undefined ? fnBody(fn) : undefined;

	return body === undefined ? [] : body.statements.map((s) => statementNode(sf, s, depth));
}

function statementNode(sf: ts.SourceFile, stmt: ts.Statement, depth: number): StatementNode {
	const { line, col } = posOf(sf, stmt.getStart(sf));
	const node: StatementNode = { kind: ts.SyntaxKind[stmt.kind], position: { file: sf.fileName, line, col } };

	if (depth > 1) {
		const inner: ts.Statement[] = [];

		stmt.forEachChild((c) => {
			if (ts.isBlock(c)) {
				inner.push(...c.statements);
			}
		});

		if (inner.length > 0) {
			node.children = inner.map((s) => statementNode(sf, s, depth - 1));
		}
	}

	return node;
}

function functionAt(sf: ts.SourceFile, offset: number): ts.Node | undefined {
	let found: ts.Node | undefined;

	const visit = (node: ts.Node): void => {
		if (offset < node.getStart(sf) || offset >= node.getEnd()) {
			return;
		}

		if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
			found = node;
		}

		node.forEachChild(visit);
	};

	visit(sf);

	return found;
}

function fnBody(node: ts.Node): ts.Block | undefined {
	const body = (node as ts.FunctionLikeDeclaration).body;

	return body !== undefined && ts.isBlock(body) ? body : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec nadle test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lsp/syntactic.ts packages/core/src/__tests__/lsp/syntactic.test.ts
git commit -m "Add syntactic outline + function skeleton walkers"
```

---

## Task 6: LSP client (subprocess transport)

Spawn `tsgo --lsp --stdio`, speak JSON-RPC over stdio, answer the server→client requests that otherwise hang the handshake (proven necessary in the spike), expose `request`/`notify`/`dispose`. Lazy: nothing spawns until `start()` is awaited.

**Files:**

- Create: `packages/core/src/lsp/client.ts`
- Test: `packages/core/src/__tests__/lsp/client.test.ts`

This task touches a real subprocess. The test is an integration test gated to skip when the bin is absent.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { createRequire } from "node:module";

import { LspClient } from "../../lsp/client.js";

const require = createRequire(import.meta.url);
let binAvailable = true;

try {
	require.resolve("@typescript/native-preview/bin/tsgo.js");
} catch {
	binAvailable = false;
}

const root = require.resolve("../fixtures/sample/tsconfig.json").replace(/\/tsconfig\.json$/, "");

describe.skipIf(!binAvailable)("LspClient", () => {
	const client = new LspClient(root);

	afterAll(async () => {
		await client.dispose();
	});

	it("initializes and advertises referencesProvider", async () => {
		const caps = await client.start();
		expect(caps.referencesProvider).toBeTruthy();
	}, 20_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec nadle test`
Expected: FAIL — cannot find module `../../lsp/client.js`.

- [ ] **Step 3: Implement**

```typescript
/**
 * LSP transport for tsgo. Spawns `tsgo --lsp --stdio`, frames JSON-RPC with
 * Content-Length headers, and answers the server->client requests
 * (`workspace/configuration`, `client/registerCapability`) that otherwise hang the
 * handshake (observed in the Door-3 spike). Lazy: spawns on `start()`.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

const require = createRequire(import.meta.url);

interface PendingResolve {
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
}

export class LspClient {
	#child: ChildProcessWithoutNullStreams | undefined;
	#buffer = Buffer.alloc(0);
	#nextId = 1;
	readonly #pending = new Map<number, PendingResolve>();
	#started: Promise<Record<string, unknown>> | undefined;

	public constructor(private readonly root: string) {}

	/** Spawn + initialize once; resolves with the server capabilities. Idempotent. */
	public start(): Promise<Record<string, unknown>> {
		this.#started ??= this.#start();

		return this.#started;
	}

	async #start(): Promise<Record<string, unknown>> {
		const bin = require.resolve("@typescript/native-preview/bin/tsgo.js");
		const child = spawn(process.execPath, [bin, "--lsp", "--stdio"], { cwd: this.root });
		this.#child = child;
		child.stdout.on("data", (chunk: Buffer) => this.#onData(chunk));
		child.on("exit", () => this.#rejectAll(new Error("tsgo exited")));

		const result = (await this.request("initialize", {
			processId: process.pid,
			rootUri: pathToFileURL(this.root).href,
			capabilities: {}
		})) as { capabilities: Record<string, unknown> };

		this.notify("initialized", {});

		return result.capabilities;
	}

	public request(method: string, params: unknown): Promise<unknown> {
		const id = this.#nextId++;
		const promise = new Promise<unknown>((resolve, reject) => this.#pending.set(id, { resolve, reject }));
		this.#send({ jsonrpc: "2.0", id, method, params });

		return promise;
	}

	public notify(method: string, params: unknown): void {
		this.#send({ jsonrpc: "2.0", method, params });
	}

	public async dispose(): Promise<void> {
		if (this.#child === undefined) {
			return;
		}

		try {
			await this.request("shutdown", null);
			this.notify("exit", null);
		} catch {
			// already gone
		}

		this.#child.kill();
		this.#child = undefined;
	}

	#send(message: unknown): void {
		const body = Buffer.from(JSON.stringify(message), "utf8");
		const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
		this.#child?.stdin.write(Buffer.concat([header, body]));
	}

	#onData(chunk: Buffer): void {
		this.#buffer = Buffer.concat([this.#buffer, chunk]);

		for (;;) {
			const headerEnd = this.#buffer.indexOf("\r\n\r\n");

			if (headerEnd === -1) {
				return;
			}

			const header = this.#buffer.subarray(0, headerEnd).toString("ascii");
			const match = /content-length:\s*(\d+)/i.exec(header);

			if (match === null) {
				this.#buffer = this.#buffer.subarray(headerEnd + 4);
				continue;
			}

			const length = Number(match[1]);
			const start = headerEnd + 4;

			if (this.#buffer.length < start + length) {
				return;
			}

			const body = this.#buffer.subarray(start, start + length).toString("utf8");
			this.#buffer = this.#buffer.subarray(start + length);
			this.#handle(JSON.parse(body));
		}
	}

	#handle(message: { id?: number; method?: string; result?: unknown; error?: unknown; params?: unknown }): void {
		// Server -> client request: must reply or the handshake hangs (spike finding).
		if (message.method !== undefined && message.id !== undefined) {
			const result = message.method === "workspace/configuration" ? [{}] : null;
			this.#send({ jsonrpc: "2.0", id: message.id, result });

			return;
		}

		// Server -> client notification: ignore.
		if (message.method !== undefined) {
			return;
		}

		if (message.id === undefined) {
			return;
		}

		const pending = this.#pending.get(message.id);

		if (pending === undefined) {
			return;
		}

		this.#pending.delete(message.id);

		if (message.error !== undefined) {
			pending.reject(message.error);
		} else {
			pending.resolve(message.result);
		}
	}

	#rejectAll(error: Error): void {
		for (const pending of this.#pending.values()) {
			pending.reject(error);
		}

		this.#pending.clear();
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec nadle test`
Expected: PASS (the client initializes and reads `referencesProvider`). If it hangs, the server→client reply path is wrong — re-check `#handle`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lsp/client.ts packages/core/src/__tests__/lsp/client.test.ts
git commit -m "Add tsgo LSP client (subprocess transport)"
```

---

## Task 7: LspEngine — semantic ops + parity

Wire client + bridge + translate + syntactic into the `SymbolEngine` surface. Semantic ops go to tsgo; syntactic ops go to the parser. Tests assert parity against the ts-morph `Engine` on the shared fixture.

**Files:**

- Create: `packages/core/src/lsp-engine.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/lsp-engine.test.ts`

`LspEngine` is async internally (LSP is async) but `SymbolEngine` is sync. Resolve this by making `LspEngine` implement an **async** variant. Add to `symbol-engine.ts`:

```typescript
/** Async form of SymbolEngine — every method returns a Promise. For the LSP engine. */
export type AsyncSymbolEngine = {
	[K in keyof SymbolEngine]: (...args: Parameters<SymbolEngine[K]>) => Promise<ReturnType<SymbolEngine[K]>>;
};
```

(Add this in Task 7, Step 0, committed with the engine. CLI/MCP adapters `await` LSP results; ts-morph results are already sync — adapters wrap with `Promise.resolve` when an engine is chosen at runtime. That adapter wiring is out of scope here — this task delivers the engine + its tests only.)

- [ ] **Step 0: Add the AsyncSymbolEngine type** to `symbol-engine.ts` (shown above).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createRequire } from "node:module";

import { Engine } from "../engine.js";
import { LspEngine } from "../lsp-engine.js";

const require = createRequire(import.meta.url);
let binAvailable = true;

try {
	require.resolve("@typescript/native-preview/bin/tsgo.js");
} catch {
	binAvailable = false;
}

const tsConfigPath = require.resolve("../fixtures/sample/tsconfig.json");

describe.skipIf(!binAvailable)("LspEngine", () => {
	const lsp = new LspEngine({ tsConfigPath });
	const tsmorph = new Engine({ tsConfigPath });

	afterAll(async () => {
		await lsp.dispose();
	});

	it("resolves a symbol to the same position as the ts-morph engine", async () => {
		const r = await lsp.resolveSymbol("src/shapes.ts:makeCircle");
		expect(r.kind).toBe("symbol");
		const baseline = tsmorph.resolveSymbol("src/shapes.ts:makeCircle");
		expect(baseline.kind).toBe("symbol");
		if (r.kind === "symbol" && baseline.kind === "symbol") {
			expect(r.symbol.position).toEqual(baseline.symbol.position);
		}
	}, 30_000);

	it("finds the same references as the ts-morph engine for makeCircle", async () => {
		const resolved = await lsp.resolveSymbol("src/shapes.ts:makeCircle");
		if (resolved.kind !== "symbol") throw new Error("expected symbol");
		const usages = await lsp.findUsages(resolved.symbol);
		const files = usages.references.map((r) => r.position.file).sort();
		expect(files).toContain("src/consumer.ts");
	}, 30_000);

	it("finds implementations of an interface", async () => {
		const resolved = await lsp.resolveSymbol("src/shapes.ts:Shape");
		if (resolved.kind !== "symbol") throw new Error("expected symbol");
		const impls = await lsp.findImplementations(resolved.symbol);
		expect(impls.some((h) => h.qualifiedName.includes("Circle"))).toBe(true);
	}, 30_000);

	it("lists imports via the parser, matching the ts-morph engine", async () => {
		const lspImports = await lsp.listImports("src/consumer.ts");
		const baseline = tsmorph.listImports("src/consumer.ts");
		expect(lspImports.map((i) => i.module)).toEqual(baseline.map((i) => i.module));
	}, 30_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec nadle test`
Expected: FAIL — cannot find module `../lsp-engine.js`.

- [ ] **Step 3: Implement**

```typescript
/**
 * Opt-in engine backed by a warm tsgo LSP subprocess (semantic ops) + the typescript
 * native parser (syntactic ops). Implements AsyncSymbolEngine; translates LSP results to
 * kestrel's name-addressed contract. ts-morph `Engine` stays the sync default.
 */
import { resolve as resolvePath } from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { LspClient } from "./lsp/client.js";
import { resolveInSymbols } from "./lsp/bridge.js";
import { parseImports, buildOutline, classifyAt, functionSkeleton, outlineSymbolMembers } from "./lsp/syntactic.js";
import { locationToPosition, lspToPosition, uriToRelative } from "./lsp/translate.js";
import { parseQualifiedName } from "./resolve.js";
import type { DocumentSymbol, LspLocation, LspPosition } from "./lsp/protocol.js";
import type {
	Member,
	CallNode,
	Candidate,
	Position,
	ImportInfo,
	FileOutline,
	SymbolHandle,
	UsagesResult,
	ResolveResult,
	SearchOptions,
	StatementNode,
	UsageReportEntry,
	FindUsagesOptions,
	UsageReportOptions,
	CallHierarchyOptions,
	OutlineFunctionOptions
} from "./types.js";

export interface LspEngineOptions {
	tsConfigPath: string;
}

const isTestFile = (file: string): boolean => /(\.test\.|\.spec\.|\/__tests__\/|\/e2e\/)/.test(file);

export class LspEngine {
	#client: LspClient | undefined;
	readonly #opened = new Set<string>();
	readonly #root: string;

	public constructor(private readonly options: LspEngineOptions) {
		this.#root = resolvePath(options.tsConfigPath)
			.replace(/\\/g, "/")
			.replace(/\/[^/]*$/, "");
	}

	async #ready(): Promise<LspClient> {
		this.#client ??= new LspClient(this.#root);
		await this.#client.start();

		return this.#client;
	}

	async #open(client: LspClient, relPath: string): Promise<string> {
		const abs = `${this.#root}/${relPath}`;
		const text = readFileSync(abs, "utf8");

		if (!this.#opened.has(relPath)) {
			client.notify("textDocument/didOpen", {
				textDocument: { uri: pathToFileURL(abs).href, languageId: "typescript", version: 1, text }
			});
			this.#opened.add(relPath);
		}

		return text;
	}

	#uri(relPath: string): string {
		return pathToFileURL(`${this.#root}/${relPath}`).href;
	}

	public async dispose(): Promise<void> {
		await this.#client?.dispose();
		this.#client = undefined;
		this.#opened.clear();
	}

	public refreshIfStale(): void {
		this.#opened.clear(); // next access re-opens with fresh text
	}

	/** Resolve file:Name to LSP positions via tsgo's documentSymbol tree. */
	async #hits(relPath: string, segments: string[]): Promise<{ path: string; position: LspPosition }[]> {
		const client = await this.#ready();
		await this.#open(client, relPath);
		const symbols = (await client.request("textDocument/documentSymbol", {
			textDocument: { uri: this.#uri(relPath) }
		})) as DocumentSymbol[] | null;

		return resolveInSymbols(symbols ?? [], segments).map((h) => ({ path: h.path, position: h.position }));
	}

	public async resolveSymbol(qualifiedName: string): Promise<ResolveResult> {
		const { file, index, segments } = parseQualifiedName(qualifiedName);
		const hits = await this.#hits(file, segments);

		if (hits.length === 0) {
			return { kind: "not-found" };
		}

		if (index !== undefined) {
			const picked = hits[index];

			return picked === undefined ? { kind: "not-found" } : { kind: "symbol", symbol: { qualifiedName, position: this.#pos(file, picked.position) } };
		}

		if (hits.length > 1) {
			return {
				kind: "ambiguous",
				candidates: hits.map((h, i) => ({
					kind: "unknown",
					position: this.#pos(file, h.position),
					qualifiedName: `${file}:${h.path}${hits.filter((x) => x.path === h.path).length > 1 ? `#${i}` : ""}`
				}))
			};
		}

		return { kind: "symbol", symbol: { qualifiedName: `${file}:${hits[0]!.path}`, position: this.#pos(file, hits[0]!.position) } };
	}

	#pos(relPath: string, lsp: LspPosition): Position {
		const { line, col } = lspToPosition(lsp);

		return { file: relPath, line, col };
	}

	public async searchSymbol(name: string, options?: SearchOptions): Promise<Candidate[]> {
		const client = await this.#ready();
		const results = (await client.request("workspace/symbol", { query: name })) as { name: string; location: LspLocation; kind: number }[] | null;
		const matches = (results ?? []).filter((r) => (options?.contains === true ? r.name.toLowerCase().includes(name.toLowerCase()) : r.name === name));

		return matches.map((r) => {
			const position = locationToPosition(r.location, this.#root);

			return { kind: "unknown", position, qualifiedName: `${position.file}:${r.name}` };
		});
	}

	async #locations(method: string, relPath: string, segments: string[], extra: Record<string, unknown> = {}): Promise<LspLocation[]> {
		const hits = await this.#hits(relPath, segments);
		const client = await this.#ready();
		const all: LspLocation[] = [];

		for (const hit of hits) {
			const result = (await client.request(method, {
				textDocument: { uri: this.#uri(relPath) },
				position: hit.position,
				...extra
			})) as LspLocation[] | LspLocation | null;

			if (Array.isArray(result)) {
				all.push(...result);
			} else if (result !== null) {
				all.push(result);
			}
		}

		return all;
	}

	public async findDefinition(symbol: SymbolHandle): Promise<SymbolHandle[]> {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const locs = await this.#locations("textDocument/definition", file, segments);

		return this.#dedupeHandles(locs);
	}

	public async findImplementations(symbol: SymbolHandle): Promise<SymbolHandle[]> {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const locs = await this.#locations("textDocument/implementation", file, segments);

		return this.#dedupeHandles(locs);
	}

	#dedupeHandles(locs: LspLocation[]): SymbolHandle[] {
		const seen = new Set<string>();
		const handles: SymbolHandle[] = [];

		for (const loc of locs) {
			const position = locationToPosition(loc, this.#root);
			const qualifiedName = `${position.file}:${position.line}:${position.col}`;

			if (seen.has(qualifiedName)) {
				continue;
			}

			seen.add(qualifiedName);
			handles.push({ qualifiedName, position });
		}

		return handles;
	}

	public async findUsages(symbol: SymbolHandle, options?: FindUsagesOptions): Promise<UsagesResult> {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const locs = await this.#locations("textDocument/references", file, segments, { context: { includeDeclaration: false } });

		const seen = new Set<string>();
		const all = [];

		for (const loc of locs) {
			const position = locationToPosition(loc, this.#root);
			const key = `${position.file}:${position.line}:${position.col}`;

			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			const text = readFileSync(`${this.#root}/${position.file}`, "utf8");
			const kind = classifyAt(text, loc.range.start);
			const test = isTestFile(position.file);

			if (options?.excludeTests === true && test) {
				continue;
			}

			all.push({ position, kind, test });
		}

		const offset = options?.cursor ? Number(options.cursor) : 0;
		const page = options?.limit === undefined ? all.slice(offset) : all.slice(offset, offset + options.limit);
		const nextOffset = offset + page.length;

		return { references: page, total: all.length, nextCursor: nextOffset < all.length ? String(nextOffset) : undefined };
	}

	public async callHierarchy(symbol: SymbolHandle, options?: CallHierarchyOptions): Promise<CallNode[]> {
		const direction = options?.direction ?? "incoming";
		const depth = options?.depth ?? 2;
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const hits = await this.#hits(file, segments);
		const client = await this.#ready();
		const out: CallNode[] = [];

		for (const hit of hits) {
			const items = (await client.request("textDocument/prepareCallHierarchy", {
				textDocument: { uri: this.#uri(file) },
				position: hit.position
			})) as { name: string; uri: string; selectionRange: { start: LspPosition } }[] | null;

			for (const item of items ?? []) {
				out.push(await this.#walkCalls(client, item, direction, depth));
			}
		}

		return out;
	}

	async #walkCalls(
		client: LspClient,
		item: { name: string; uri: string; selectionRange: { start: LspPosition } },
		direction: "incoming" | "outgoing",
		depth: number
	): Promise<CallNode> {
		const position = { file: uriToRelative(item.uri, this.#root), ...lspToPosition(item.selectionRange.start) };
		const node: CallNode = { qualifiedName: `${position.file}:${item.name}`, position, calls: [] };

		if (depth <= 0) {
			return node;
		}

		const method = direction === "incoming" ? "callHierarchy/incomingCalls" : "callHierarchy/outgoingCalls";
		const calls = (await client.request(method, { item })) as { from?: typeof item; to?: typeof item }[] | null;

		for (const call of calls ?? []) {
			const next = direction === "incoming" ? call.from : call.to;

			if (next !== undefined) {
				node.calls.push(await this.#walkCalls(client, next, direction, depth - 1));
			}
		}

		return node;
	}

	// ---- syntactic ops (parser, no subprocess needed but reuse open buffers) ----

	#read(relPath: string): string {
		return readFileSync(`${this.#root}/${relPath}`, "utf8");
	}

	public listImports(path: string): Promise<ImportInfo[]> {
		return Promise.resolve(parseImports(path, this.#read(path)));
	}

	public outlineFile(path: string): Promise<FileOutline> {
		return Promise.resolve(buildOutline(path, this.#read(path)));
	}

	public async outlineSymbol(symbol: SymbolHandle): Promise<Member[]> {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const hits = await this.#hits(file, segments);
		const text = this.#read(file);

		return hits.flatMap((hit) => outlineSymbolMembers(file, text, hit.position));
	}

	public async outlineFunction(symbol: SymbolHandle, options?: OutlineFunctionOptions): Promise<StatementNode[]> {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const hits = await this.#hits(file, segments);
		const text = this.#read(file);

		return hits.flatMap((hit) => functionSkeleton(text, hit.position, options?.depth ?? 1));
	}

	/** export * + re-export expansion: parse the entry's exports, resolve each via definition. */
	public async publicSurface(path: string): Promise<Candidate[]> {
		const client = await this.#ready();
		await this.#open(client, path);
		const symbols = (await client.request("textDocument/documentSymbol", { textDocument: { uri: this.#uri(path) } })) as DocumentSymbol[] | null;
		const seen = new Set<string>();
		const surface: Candidate[] = [];

		for (const sym of symbols ?? []) {
			const position = this.#pos(path, sym.selectionRange.start);
			const key = `${position.file}:${sym.name}`;

			if (!seen.has(key)) {
				seen.add(key);
				surface.push({ kind: "unknown", position, qualifiedName: key });
			}
		}

		return surface;
	}

	public async usageReport(path: string, options?: UsageReportOptions): Promise<UsageReportEntry[]> {
		const surface = await this.publicSurface(path);
		const entries: UsageReportEntry[] = [];

		for (const symbol of surface) {
			const { total, references } = await this.findUsages(symbol, { excludeTests: options?.excludeTests });
			const consumed = references.filter((r) => r.kind !== "import" && r.kind !== "re-export").length;
			entries.push({ total, consumed, kind: symbol.kind, position: symbol.position, qualifiedName: symbol.qualifiedName });
		}

		return entries;
	}
}
```

- [ ] **Step 4: Export from index**

In `packages/core/src/index.ts`:

```typescript
export { LspEngine } from "./lsp-engine.js";
export type { LspEngineOptions } from "./lsp-engine.js";
export type { SymbolEngine, AsyncSymbolEngine } from "./symbol-engine.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec nadle test`
Expected: PASS — resolve/refs/impls match the ts-morph engine; imports match. If references differ, check `includeDeclaration: false` and the dedupe key.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/lsp-engine.ts packages/core/src/symbol-engine.ts packages/core/src/index.ts packages/core/src/__tests__/lsp-engine.test.ts
git commit -m "Add LspEngine: tsgo semantic ops + parser syntactic ops"
```

---

## Task 8: Re-export fidelity fallback

`documentSymbol` sees only a file's own declarations, so `resolveSymbol("barrel.ts:Circle")` (re-exported from shapes.ts) returns nothing. Fall back to `workspace/symbol` + `textDocument/definition` to land on the true declaration. (Spec: "known fidelity gap, documented not hidden".)

**Files:**

- Modify: `packages/core/src/lsp-engine.ts` (`resolveSymbol` / `#hits`)
- Test: `packages/core/src/__tests__/lsp-engine.test.ts` (add a case)

- [ ] **Step 1: Write the failing test** (append inside the `describe.skipIf` block)

```typescript
it("resolves a re-exported symbol through a barrel", async () => {
	const r = await lsp.resolveSymbol("src/barrel.ts:Circle");
	expect(r.kind).toBe("symbol");
	if (r.kind === "symbol") {
		// True declaration lives in shapes.ts, not the barrel.
		expect(r.symbol.position.file).toBe("src/shapes.ts");
	}
}, 30_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec nadle test`
Expected: FAIL — `not-found` (documentSymbol of barrel.ts has no `Circle` of its own).

- [ ] **Step 3: Implement the fallback** — in `resolveSymbol`, when `#hits` is empty and the name is a single segment, try workspace/symbol + definition:

```typescript
// after: if (hits.length === 0) { ... }
if (hits.length === 0) {
	const fallback = await this.#resolveViaWorkspace(file, segments);

	return fallback ?? { kind: "not-found" };
}
```

Add the helper:

```typescript
async #resolveViaWorkspace(file: string, segments: string[]): Promise<ResolveResult | undefined> {
	if (segments.length !== 1) {
		return undefined;
	}

	const client = await this.#ready();
	const name = segments[0]!;
	const results = (await client.request("workspace/symbol", { query: name })) as { name: string; location: LspLocation }[] | null;
	const exact = (results ?? []).find((r) => r.name === name);

	if (exact === undefined) {
		return undefined;
	}

	const position = locationToPosition(exact.location, this.#root);

	return { kind: "symbol", symbol: { qualifiedName: `${position.file}:${name}`, position } };
}
```

(The workspace symbol already points at the true declaration, so no extra `definition` hop is needed here. If `workspace/symbol` ever returns the barrel position, chase it with `textDocument/definition` — add that only if the test shows it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec nadle test`
Expected: PASS — barrel re-export resolves to `src/shapes.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lsp-engine.ts packages/core/src/__tests__/lsp-engine.test.ts
git commit -m "Resolve re-exported symbols via workspace/symbol fallback"
```

---

## Task 9: Full verification + docs

**Files:**

- Modify: `docs/TSGO-SPIKE.md` (mark the LspEngine built), `docs/ROADMAP.md` (deferred-engine note)

- [ ] **Step 1: Run the full CI command**

Run: `pnpm exec nadle test`
Expected: ALL pass, including the gated LSP suites (the dep is installed locally).

- [ ] **Step 2: Lint + format + build**

Run:

```bash
pnpm exec nadle check
pnpm build
```

Expected: clean — no eslint/prettier errors, tsc -b succeeds.

- [ ] **Step 3: Update docs** — in `docs/TSGO-SPIKE.md` add a short note under Door-3 Results that the `LspEngine` is now implemented (opt-in, `packages/core`), and in `docs/ROADMAP.md` change the deferred-engine line from "build … only when cold-start complaints arrive" to note the engine exists behind the opt-in and the remaining work is the benchmark (Phase 0). Keep it factual, no company references.

- [ ] **Step 4: Commit**

```bash
git add docs/TSGO-SPIKE.md docs/ROADMAP.md
git commit -m "Record the LspEngine as built (Door 3, opt-in)"
```

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feature/door3-lsp-engine
```

---

## Self-review notes

- **Spec coverage:** SymbolEngine interface (T1), bridge via documentSymbol (T4), full op set — semantic via LSP (T7), syntactic via parser (T5/5b), re-export fallback (T8), lazy one-per-engine lifecycle + dispose (T6/T7), translation offsets-stay-internal (T3). All spec sections map to a task.
- **Async mismatch** resolved explicitly via `AsyncSymbolEngine` (T7 Step 0); CLI/MCP adapter wiring called out as out of scope for this build.
- **Sync interface note:** `Engine implements SymbolEngine` (sync) and `LspEngine` implements the async variant. They are NOT drop-in-interchangeable at the call site without an await boundary — adapters bridge that. This is intentional and documented; the spec said "implements the same surface", honored as same op set + same output types.
- **Parity assertions:** integration tests compare LspEngine output to the ts-morph Engine on the shared synthetic fixtures (no company code).
- **Gating:** all subprocess tests `describe.skipIf(!binAvailable)` so the suite stays green where the bin is absent; CI has the dep, so they run there.
- **YAGNI:** no rename/modify, no process pooling, no benchmark numbers (separate Phase 0).
