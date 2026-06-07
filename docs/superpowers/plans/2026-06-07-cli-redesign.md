# CLI Command Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regroup kestrel's CLI + MCP surface into `view` (read code) and `find` (locate/trace) families plus top-level addressing/whole-file commands, and add three source-reading ops — `view symbol`, `view region`, `view context` — with old names kept as hidden aliases. ts-morph stays the default engine.

**Architecture:** Add three engine ops to core (`symbolSource`, `readRegion`, `symbolContext`) on the shared `SymbolEngine` interface + both engines, with new result types. Then restructure the CLI into citty parent commands, regularize the MCP tool names, and keep old names as aliases. Engine _semantics_ of existing ops are untouched — only names/grouping change.

**Tech Stack:** TypeScript 6, ts-morph (default engine), tsgo LSP + `typescript` parser (opt-in engine), citty (CLI), `@modelcontextprotocol/sdk` + zod (MCP), vitest, nadle.

**Source of truth:** [docs/superpowers/specs/2026-06-07-cli-command-redesign.md](../specs/2026-06-07-cli-command-redesign.md).

## Conventions (apply to every task)

- ESM, `.js` import suffixes, strict TS. Prettier TABS, printWidth 150. eslint perfectionist auto-fix is fine (`pnpm exec eslint --fix <files>`); a private method with >4 params fails `max-params` (bundle into an options object).
- TDD: write the failing test, run it and SEE it fail, implement, see it pass.
- Verify from the REPO ROOT: `pnpm exec nadle test` (authority), `pnpm exec nadle check`, `pnpm build`. LSP suites run when the tsgo bin is present (it is, locally).
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Subject imperative, capitalized, no trailing period, ≤50 chars.
- Branch `feat/cli-redesign` is already checked out — work on it; do NOT create a new branch.

## File structure

```
packages/core/src/
  types.ts            (modify) add SourceResult, RegionResult, SymbolContext + new SymbolEngine methods
  symbol-engine.ts    (modify) add symbolSource / readRegion / symbolContext to the interface
  engine.ts           (modify) implement the three ops (ts-morph)
  lsp-engine.ts       (modify) implement the three ops (parser-based + existing callHierarchy)
  create-engine.ts    (modify) asAsync wrapper gains the three new methods
  lsp/syntactic.ts    (modify) add typeRefsAt (syntactic TypeReference name pass) for view context
packages/cli/src/index.ts   (rewrite) view/find parent commands + top-level + aliases
packages/mcp/src/index.ts   (modify) regularized tool names + old-name aliases + new tools
packages/core/src/__tests__/
  symbol-source.test.ts   (new)
  read-region.test.ts     (new)
  symbol-context.test.ts  (new)
packages/cli/src/__tests__/cli.test.ts   (modify) add view/find + alias cases
README.md                  (modify) new command names + renamed-commands note
```

---

## Task 1: Core op `symbolSource` (exact declaration source)

**Files:**

- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/symbol-engine.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/src/lsp-engine.ts`
- Modify: `packages/core/src/create-engine.ts`
- Test: `packages/core/src/__tests__/symbol-source.test.ts`

- [ ] **Step 1: Add the result type** to `packages/core/src/types.ts` (after `SymbolHandle`):

```typescript
/** Exact source text of one declaration of a resolved symbol. */
export interface SourceResult {
	position: Position;
	qualifiedName: string;
	/** The declaration's source, from its start to its end (signature + body). */
	source: string;
}
```

- [ ] **Step 2: Add to the SymbolEngine interface** in `packages/core/src/symbol-engine.ts` (add the import of `SourceResult` to the type import block, then the method):

```typescript
	symbolSource(symbol: SymbolHandle): SourceResult[];
```

- [ ] **Step 3: Write the failing test** — `packages/core/src/__tests__/symbol-source.test.ts`:

```typescript
import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";
import type { SymbolHandle } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

function resolve(engine: Engine, name: string): SymbolHandle {
	const r = engine.resolveSymbol(name);
	if (r.kind !== "symbol") throw new Error(`expected symbol, got ${r.kind}`);
	return r.symbol;
}

describe("symbolSource", () => {
	test("returns the exact declaration source of a function", () => {
		const engine = new Engine({ tsConfigPath });
		const [src] = engine.symbolSource(resolve(engine, "src/shapes.ts:makeCircle"));

		expect(src!.source).toContain("export function makeCircle");
		expect(src!.source).toContain("return new Circle");
		expect(src!.qualifiedName).toBe("src/shapes.ts:makeCircle");
		expect(src!.position.file).toBe("src/shapes.ts");
	});

	test("returns the class body source", () => {
		const engine = new Engine({ tsConfigPath });
		const [src] = engine.symbolSource(resolve(engine, "src/shapes.ts:Circle"));

		expect(src!.source).toContain("class Circle");
		expect(src!.source).toContain("area()");
	});
});
```

- [ ] **Step 4: Run, verify FAIL**

Run: `pnpm exec nadle test`
Expected: FAIL — `engine.symbolSource is not a function` (and a type error if the interface is wired; that's fine, the test file drives it).

- [ ] **Step 5: Implement in `engine.ts`** — add the method to the `Engine` class (near `findDefinition`). It reuses `#declarationsFor` + `declarationToHandle`:

```typescript
	/** Exact source of each declaration of a symbol (signature + body). */
	public symbolSource(symbol: SymbolHandle): SourceResult[] {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const path = segments.join(".");
		const base = this.#baseDir();

		return this.#declarationsFor(symbol).map((node) => {
			const handle = declarationToHandle({ node, path }, file, base);

			return { position: handle.position, qualifiedName: handle.qualifiedName, source: node.getText() };
		});
	}
```

Add `SourceResult` to the type import block at the top of `engine.ts`.

- [ ] **Step 6: Implement in `lsp-engine.ts`** — the LSP engine resolves via `#hits` then reads the declaration source from the file using the parser. Add a helper to `lsp/syntactic.ts` first:

```typescript
/** Exact source of the declaration whose name token is at the given LSP position. */
export function declarationSourceAt(text: string, pos: LspPosition): string | undefined {
	const sf = parse("__src.ts", text);
	const offset = sf.getPositionOfLineAndCharacter(pos.line, pos.character);
	let decl: ts.Node | undefined;

	const visit = (node: ts.Node): void => {
		if (offset < node.getStart(sf) || offset >= node.getEnd()) {
			return;
		}

		// Track the smallest enclosing *declaration* (class/interface/fn/var/type/namespace/member).
		if (
			ts.isClassDeclaration(node) ||
			ts.isInterfaceDeclaration(node) ||
			ts.isFunctionDeclaration(node) ||
			ts.isTypeAliasDeclaration(node) ||
			ts.isModuleDeclaration(node) ||
			ts.isVariableStatement(node) ||
			ts.isMethodDeclaration(node) ||
			ts.isPropertyDeclaration(node)
		) {
			decl = node;
		}

		node.forEachChild(visit);
	};

	visit(sf);

	return decl?.getText(sf);
}
```

Then in `lsp-engine.ts` add the method (uses the existing `#hits` + `#read` + `#pos`):

```typescript
	public async symbolSource(symbol: SymbolHandle): Promise<SourceResult[]> {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const hits = await this.#hits(file, segments);
		const text = this.#read(file);

		return hits.map((hit) => ({
			position: this.#pos(file, hit.rangeStart),
			qualifiedName: `${file}:${hit.path}`,
			source: declarationSourceAt(text, hit.position) ?? ""
		}));
	}
```

Add `declarationSourceAt` to the `./lsp/syntactic.js` import, and `SourceResult` to the type imports, in `lsp-engine.ts`.

- [ ] **Step 7: Wire the async bridge** in `packages/core/src/create-engine.ts` — add to the `asAsync` returned object:

```typescript
		symbolSource: (symbol) => Promise.resolve(engine.symbolSource(symbol)),
```

- [ ] **Step 8: Run, verify PASS**

Run: `pnpm exec nadle test`
Expected: PASS. `pnpm build` succeeds (interface satisfied by both engines).

- [ ] **Step 9: Add an LSP parity test** — append to `symbol-source.test.ts`:

```typescript
import { createRequire } from "node:module";

import { LspEngine } from "../index.js";
import { tsgoBinPath } from "../lsp/tsgo-bin.js";

const binAvailable = tsgoBinPath() !== undefined;

describe.skipIf(!binAvailable)("symbolSource (lsp parity)", () => {
	test("lsp engine returns source containing the declaration", async () => {
		const lsp = new LspEngine({ tsConfigPath });
		try {
			const r = await lsp.resolveSymbol("src/shapes.ts:makeCircle");
			if (r.kind !== "symbol") throw new Error("expected symbol");
			const [src] = await lsp.symbolSource(r.symbol);
			expect(src!.source).toContain("makeCircle");
		} finally {
			await lsp.dispose();
		}
	}, 30_000);
});
```

- [ ] **Step 10: Run + check + commit**

Run: `pnpm exec nadle test` (PASS), `pnpm exec nadle check` (fix only your files), `pnpm build`.

```bash
git add packages/core/src/types.ts packages/core/src/symbol-engine.ts packages/core/src/engine.ts packages/core/src/lsp-engine.ts packages/core/src/lsp/syntactic.ts packages/core/src/create-engine.ts packages/core/src/__tests__/symbol-source.test.ts
git commit -m "Add symbolSource: exact declaration source by name"
```

---

## Task 2: Core op `readRegion` (addressed line range)

**Files:**

- Modify: `packages/core/src/types.ts`, `symbol-engine.ts`, `engine.ts`, `lsp-engine.ts`, `create-engine.ts`
- Test: `packages/core/src/__tests__/read-region.test.ts`

`readRegion` is engine-independent (reads the file), but lives on the interface so both engines expose it. Implement the real logic once in a shared helper and call it from both.

- [ ] **Step 1: Add the result type** to `types.ts`:

```typescript
/** A verbatim slice of a file by 1-based inclusive line range. */
export interface RegionResult {
	file: string;
	startLine: number;
	endLine: number;
	source: string;
}
```

- [ ] **Step 2: Add a shared helper** — create `packages/core/src/region.ts`:

```typescript
/** Read a 1-based inclusive line range from a file's text. Engine-independent. */
import { readFileSync } from "node:fs";

import type { RegionResult } from "./types.js";

export function readRegionFrom(absPath: string, file: string, startLine: number, endLine: number): RegionResult {
	if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
		throw new Error(`invalid line range: ${startLine}-${endLine} (expected 1-based, start <= end)`);
	}

	const lines = readFileSync(absPath, "utf8").split("\n");

	if (startLine > lines.length) {
		throw new Error(`line range out of bounds: ${startLine}-${endLine} (file has ${lines.length} lines)`);
	}

	const end = Math.min(endLine, lines.length);

	return { file, startLine, endLine: end, source: lines.slice(startLine - 1, end).join("\n") };
}
```

- [ ] **Step 3: Add to the interface** (`symbol-engine.ts`):

```typescript
	readRegion(file: string, startLine: number, endLine: number): RegionResult;
```

- [ ] **Step 4: Write the failing test** — `packages/core/src/__tests__/read-region.test.ts`:

```typescript
import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

describe("readRegion", () => {
	test("returns the requested inclusive line range", () => {
		const engine = new Engine({ tsConfigPath });
		const r = engine.readRegion("src/shapes.ts", 1, 3);

		expect(r.startLine).toBe(1);
		expect(r.endLine).toBe(3);
		expect(r.source.split("\n")).toHaveLength(3);
		expect(r.source).toContain("Shape");
	});

	test("clamps endLine to the file length", () => {
		const engine = new Engine({ tsConfigPath });
		const r = engine.readRegion("src/shapes.ts", 1, 100000);

		expect(r.endLine).toBeLessThan(100000);
	});

	test("throws on an inverted or non-positive range", () => {
		const engine = new Engine({ tsConfigPath });
		expect(() => engine.readRegion("src/shapes.ts", 5, 2)).toThrow(/invalid line range/);
		expect(() => engine.readRegion("src/shapes.ts", 0, 3)).toThrow(/invalid line range/);
	});
});
```

- [ ] **Step 5: Run, verify FAIL** (`engine.readRegion is not a function`).

- [ ] **Step 6: Implement in `engine.ts`** — resolve the file to an absolute path via the existing `#requireSourceFile` (gives a clear error for unknown files), then delegate:

```typescript
	/** A verbatim slice of a file by 1-based inclusive line range. */
	public readRegion(file: string, startLine: number, endLine: number): RegionResult {
		const sourceFile = this.#requireSourceFile(file);

		return readRegionFrom(sourceFile.getFilePath(), file, startLine, endLine);
	}
```

Add `import { readRegionFrom } from "./region.js";` and `RegionResult` to the type imports.

- [ ] **Step 7: Implement in `lsp-engine.ts`** — the LSP engine has `#root`; build the absolute path:

```typescript
	public readRegion(file: string, startLine: number, endLine: number): Promise<RegionResult> {
		return Promise.resolve(readRegionFrom(`${this.#root}/${file}`, file, startLine, endLine));
	}
```

Add the `readRegionFrom` + `RegionResult` imports.

- [ ] **Step 8: Wire the bridge** (`create-engine.ts` asAsync):

```typescript
		readRegion: (file, startLine, endLine) => Promise.resolve(engine.readRegion(file, startLine, endLine)),
```

- [ ] **Step 9: Run, verify PASS** (`pnpm exec nadle test`, `pnpm build`).

- [ ] **Step 10: Check + commit**

```bash
git add packages/core/src/types.ts packages/core/src/region.ts packages/core/src/symbol-engine.ts packages/core/src/engine.ts packages/core/src/lsp-engine.ts packages/core/src/create-engine.ts packages/core/src/__tests__/read-region.test.ts
git commit -m "Add readRegion: verbatim line-range slice by address"
```

---

## Task 3: Core op `symbolContext` (sig + body + callees + type refs)

**Files:**

- Modify: `packages/core/src/types.ts`, `symbol-engine.ts`, `engine.ts`, `lsp-engine.ts`, `create-engine.ts`, `lsp/syntactic.ts`
- Test: `packages/core/src/__tests__/symbol-context.test.ts`

Composes existing ops: source (Task 1) + outgoing call hierarchy (depth 1) + a syntactic type-ref pass + the declaration head as `signature`.

- [ ] **Step 1: Add the result type** to `types.ts`:

```typescript
/** A symbol's full local context: source, signature, what it calls, and types it references. */
export interface SymbolContext {
	position: Position;
	qualifiedName: string;
	/** Declaration head up to the body (single line, whitespace-collapsed). */
	signature: string;
	/** Full declaration source (= symbolSource). */
	source: string;
	/** Symbols this declaration calls (outgoing call hierarchy, depth 1). */
	callees: CallNode[];
	/** Distinct named types referenced in the declaration (syntactic, names only). */
	typeRefs: string[];
}
```

- [ ] **Step 2: Add to the interface** (`symbol-engine.ts`):

```typescript
	symbolContext(symbol: SymbolHandle): SymbolContext;
```

- [ ] **Step 3: Add the type-ref + signature helpers** to `lsp/syntactic.ts`:

```typescript
/** Distinct named types referenced anywhere in the given declaration source. */
export function typeRefsIn(text: string): string[] {
	const sf = parse("__types.ts", text);
	const names = new Set<string>();

	const visit = (node: ts.Node): void => {
		if (ts.isTypeReferenceNode(node)) {
			names.add(node.typeName.getText(sf));
		}

		node.forEachChild(visit);
	};

	visit(sf);

	return [...names];
}

/** The declaration head up to its body — single line, whitespace-collapsed. */
export function signatureOfSource(source: string): string {
	const brace = source.indexOf("{");
	const head = brace === -1 ? source : source.slice(0, brace);

	return head.trim().replace(/\s+/g, " ");
}
```

- [ ] **Step 4: Write the failing test** — `packages/core/src/__tests__/symbol-context.test.ts`:

```typescript
import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";
import type { SymbolHandle } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

function resolve(engine: Engine, name: string): SymbolHandle {
	const r = engine.resolveSymbol(name);
	if (r.kind !== "symbol") throw new Error(`expected symbol, got ${r.kind}`);
	return r.symbol;
}

describe("symbolContext", () => {
	test("bundles signature, source, callees and type refs", () => {
		const engine = new Engine({ tsConfigPath });
		// totalArea calls makeCircle + c.area(), references the Circle type.
		const ctx = engine.symbolContext(resolve(engine, "src/consumer.ts:totalArea"));

		expect(ctx.signature).toContain("totalArea");
		expect(ctx.signature).not.toMatch(/\{/);
		expect(ctx.source).toContain("makeCircle");
		expect(ctx.typeRefs).toContain("Circle");
		expect(Array.isArray(ctx.callees)).toBe(true);
		// makeCircle is called inside totalArea.
		expect(ctx.callees.some((c) => c.qualifiedName.includes("makeCircle"))).toBe(true);
	});

	test("empty sections are arrays, not omitted", () => {
		const engine = new Engine({ tsConfigPath });
		const ctx = engine.symbolContext(resolve(engine, "src/shapes.ts:Shape"));

		expect(Array.isArray(ctx.callees)).toBe(true);
		expect(Array.isArray(ctx.typeRefs)).toBe(true);
	});
});
```

- [ ] **Step 5: Run, verify FAIL** (`engine.symbolContext is not a function`).

- [ ] **Step 6: Implement in `engine.ts`**:

```typescript
	/** A symbol's source + signature + outgoing callees + referenced type names, in one call. */
	public symbolContext(symbol: SymbolHandle): SymbolContext {
		const sources = this.symbolSource(symbol);
		const first = sources[0];
		const source = first?.source ?? "";
		const callees = this.callHierarchy(symbol, { direction: "outgoing", depth: 1 });

		return {
			source,
			callees,
			typeRefs: typeRefsIn(source),
			signature: signatureOfSource(source),
			position: first?.position ?? symbol.position,
			qualifiedName: first?.qualifiedName ?? symbol.qualifiedName
		};
	}
```

Add `import { typeRefsIn, signatureOfSource } from "./lsp/syntactic.js";` (these are parser helpers, engine-agnostic — fine to use from the ts-morph engine too) and `SymbolContext`, `CallNode` to the type imports.

- [ ] **Step 7: Implement in `lsp-engine.ts`** (async; same composition):

```typescript
	public async symbolContext(symbol: SymbolHandle): Promise<SymbolContext> {
		const sources = await this.symbolSource(symbol);
		const first = sources[0];
		const source = first?.source ?? "";
		const callees = await this.callHierarchy(symbol, { direction: "outgoing", depth: 1 });

		return {
			source,
			callees,
			typeRefs: typeRefsIn(source),
			signature: signatureOfSource(source),
			position: first?.position ?? symbol.position,
			qualifiedName: first?.qualifiedName ?? symbol.qualifiedName
		};
	}
```

Add `typeRefsIn, signatureOfSource` to the syntactic import + `SymbolContext` to types.

- [ ] **Step 8: Wire the bridge** (`create-engine.ts`):

```typescript
		symbolContext: (symbol) => Promise.resolve(engine.symbolContext(symbol)),
```

- [ ] **Step 9: Run, verify PASS** + add an LSP parity test mirroring Task 1 Step 9 (resolve `src/consumer.ts:totalArea` on the LSP engine, assert `ctx.typeRefs` contains `Circle` and `ctx.callees` non-empty), gated on `binAvailable`.

- [ ] **Step 10: Check + commit**

```bash
git add packages/core/src/types.ts packages/core/src/symbol-engine.ts packages/core/src/engine.ts packages/core/src/lsp-engine.ts packages/core/src/lsp/syntactic.ts packages/core/src/create-engine.ts packages/core/src/__tests__/symbol-context.test.ts
git commit -m "Add symbolContext: source + signature + callees + type refs"
```

---

## Task 4: Restructure the CLI into view / find families + aliases

**Files:**

- Rewrite: `packages/cli/src/index.ts`
- Test: `packages/cli/src/__tests__/cli.test.ts` (add cases)

Read the current `packages/cli/src/index.ts` first — keep its `withEngine`, `emit`, `print`, `resolveSymbolOrThrow`, `tsconfig`, `engine` helpers exactly. Only the command tree changes.

- [ ] **Step 1: Write the failing CLI tests** — add to `packages/cli/src/__tests__/cli.test.ts` (it already spawns the built binary; mirror its existing helper for running the CLI). Add:

```typescript
// view outline == old outline-file
test("view outline prints the compact tree", async () => {
	const { stdout, code } = await runCli(["view", "outline", "src/shapes.ts", "--tsconfig", FIXTURE_TSCONFIG]);
	expect(code).toBe(0);
	expect(stdout).toContain("Circle");
});

// view symbol — new op
test("view symbol prints the declaration source", async () => {
	const { stdout, code } = await runCli(["view", "symbol", "src/shapes.ts:makeCircle", "--tsconfig", FIXTURE_TSCONFIG]);
	expect(code).toBe(0);
	expect(stdout).toContain("makeCircle");
});

// view region — new op
test("view region prints a line range", async () => {
	const { stdout, code } = await runCli(["view", "region", "src/shapes.ts:1-3", "--tsconfig", FIXTURE_TSCONFIG]);
	expect(code).toBe(0);
	expect(stdout).toContain("Shape");
});

// find callers / callees direction split
test("find callees lists outgoing calls", async () => {
	const { code } = await runCli(["find", "callees", "src/consumer.ts:totalArea", "--tsconfig", FIXTURE_TSCONFIG]);
	expect(code).toBe(0);
});

// alias: old outline-file still works
test("outline-file alias still works", async () => {
	const { stdout, code } = await runCli(["outline-file", "src/shapes.ts", "--tsconfig", FIXTURE_TSCONFIG]);
	expect(code).toBe(0);
	expect(stdout).toContain("Circle");
});
```

(If the existing test file names the helper/constants differently, reuse those — match what's there. `view region` target syntax is `file:Lstart-Lend`.)

- [ ] **Step 2: Run, verify FAIL** (`pnpm exec nadle test`) — the new commands don't exist yet.

- [ ] **Step 3: Rewrite the command tree** in `packages/cli/src/index.ts`. Keep all existing helpers. Define each leaf command once, then mount under `view` / `find` parents AND register the old names as hidden aliases. Key pieces:

`view region` parses `file:Lstart-Lend`:

```typescript
const region = defineCommand({
	meta: { name: "region", description: "Print an addressed line range: file:Lstart-Lend" },
	args: { engine, tsconfig, target: { required: true, type: "positional", description: "file:Lstart-Lend" } },
	async run({ args }) {
		await withEngine(args, async (e) => {
			const m = /^(.*):(\d+)-(\d+)$/.exec(args.target);
			if (m === null) throw new Error(`expected file:Lstart-Lend, got ${args.target}`);
			emit(await e.readRegion(m[1]!, Number(m[2]), Number(m[3])));
		});
	}
});
```

`view symbol` / `view context`:

```typescript
const viewSymbol = defineCommand({
	meta: { name: "symbol", description: "Print the exact source of a declaration" },
	args: { engine, tsconfig, symbol: { required: true, type: "positional", description: "file:name[#index]" } },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.symbolSource(await resolveSymbolOrThrow(e, args.symbol))));
	}
});

const viewContext = defineCommand({
	meta: { name: "context", description: "Source + signature + callees + referenced types" },
	args: { engine, tsconfig, symbol: { required: true, type: "positional", description: "file:name[#index]" } },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.symbolContext(await resolveSymbolOrThrow(e, args.symbol))));
	}
});
```

`view file` (outline by default, `--body` adds source of each top-level export):

```typescript
const viewFile = defineCommand({
	meta: { name: "file", description: "Token-lean whole file: outline, plus --body for source" },
	args: {
		engine,
		tsconfig,
		file: { required: true, type: "positional", description: "Relative file path" },
		body: { type: "boolean", description: "Include each export's source" }
	},
	async run({ args }) {
		await withEngine(args, async (e) => {
			const outline = await e.outlineFile(args.file);
			if (args.body !== true) {
				emit(outline);
				return;
			}
			const sources = await Promise.all(
				outline.exports.map((m) =>
					m.qualifiedName !== undefined ? e.symbolSource({ qualifiedName: m.qualifiedName, position: m.position }) : Promise.resolve([])
				)
			);
			emit({ outline, sources: sources.flat() });
		});
	}
});
```

Rename leaves: `outline` (=outline-file body), `members` (=outline-symbol), `body` (=outline-fn), `findSymbol` (=search), `findDef` (=def), `findRefs` (=refs), `findImpls` (=impls). `find callers` = `callHierarchy` incoming; `find callees` = outgoing. `exports` (=surface). Keep `resolve`, `imports`, `usage` top-level.

Mount:

```typescript
const view = defineCommand({
	meta: { name: "view", description: "Read code: structure + source" },
	subCommands: { outline: viewOutline, file: viewFile, symbol: viewSymbol, members: viewMembers, body: viewBody, region, context: viewContext }
});

const find = defineCommand({
	meta: { name: "find", description: "Locate + trace symbols" },
	subCommands: { symbol: findSymbol, def: findDef, refs: findRefs, impls: findImpls, callers: findCallers, callees: findCallees }
});

const main = defineCommand({
	meta: { name: "kestrel", description: "Semantic symbol queries for TypeScript" },
	subCommands: {
		view,
		find,
		resolve,
		imports,
		exports: exportsCmd,
		usage,
		// hidden aliases (back-compat) — same command objects, old names:
		"outline-file": viewOutline,
		"outline-symbol": viewMembers,
		"outline-fn": viewBody,
		search: findSymbol,
		def: findDef,
		refs: findRefs,
		impls: findImpls,
		calls: callsAlias, // incoming by default, --outgoing → callees
		surface: exportsCmd
	}
});
```

`callsAlias` preserves the old `calls [--outgoing] [--depth]` behavior by dispatching to the incoming/outgoing path (reuse the old `calls` body verbatim so existing scripts are unaffected).

- [ ] **Step 4: Run, verify PASS**

Run: `pnpm build` then `pnpm exec nadle test`. Expected: new view/find tests pass AND the `outline-file` alias test passes.

- [ ] **Step 5: Smoke both engines**

Run:

```bash
node ./packages/cli/dist/index.js view symbol --tsconfig packages/core/src/__tests__/fixtures/sample/tsconfig.json src/shapes.ts:makeCircle
node ./packages/cli/dist/index.js view context --engine lsp --tsconfig packages/core/src/__tests__/fixtures/sample/tsconfig.json src/consumer.ts:totalArea
```

Expected: source JSON; context JSON with callees/typeRefs. Paste both.

- [ ] **Step 6: Check + commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/__tests__/cli.test.ts
git commit -m "Restructure CLI into view/find families with aliases"
```

---

## Task 5: Regularize MCP tool names + new tools + aliases

**Files:**

- Modify: `packages/mcp/src/index.ts`
- Test: `packages/mcp/src/__tests__/mcp.test.ts` (add cases)

Read the current `packages/mcp/src/index.ts`. Keep `engineFor`, `resolveOr`, `json`, `text`, the zod arg consts, and the shutdown handling. Add new tools + rename + alias.

- [ ] **Step 1: Write failing MCP tests** — add to `packages/mcp/src/__tests__/mcp.test.ts` (reuse its existing spawn+JSON-RPC client helper):

```typescript
test("tools/list includes the regularized names", async () => {
	const tools = await listTools();
	const names = tools.map((t) => t.name);
	expect(names).toContain("view_symbol");
	expect(names).toContain("view_context");
	expect(names).toContain("find_refs");
	expect(names).toContain("exports");
	// alias retained for one release:
	expect(names).toContain("outline_file");
});

test("view_symbol returns declaration source", async () => {
	const res = await callTool("view_symbol", { tsConfig: FIXTURE_TSCONFIG, symbol: "src/shapes.ts:makeCircle" });
	expect(res).toContain("makeCircle");
});
```

- [ ] **Step 2: Run, verify FAIL** (`pnpm exec nadle test`).

- [ ] **Step 3: Add the new tools + register aliases** in `packages/mcp/src/index.ts`. Add three new tools using the existing `resolveOr` pattern:

```typescript
server.registerTool(
	"view_symbol",
	{ inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg }, description: "Exact source of a declaration." },
	async ({ symbol, engine, tsConfig: tc }) => json(await resolveOr(tc, kindOf(engine), symbol, (e, s) => e.symbolSource(s)))
);

server.registerTool(
	"view_context",
	{ inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg }, description: "Source + signature + callees + referenced types." },
	async ({ symbol, engine, tsConfig: tc }) => json(await resolveOr(tc, kindOf(engine), symbol, (e, s) => e.symbolContext(s)))
);

server.registerTool(
	"view_region",
	{
		inputSchema: { tsConfig, engine: engineArg, file: fileArg, startLine: z.number(), endLine: z.number() },
		description: "A verbatim file slice by 1-based inclusive line range."
	},
	async ({ file, engine, endLine, startLine, tsConfig: tc }) => json(await engineFor(tc, kindOf(engine)).readRegion(file, startLine, endLine))
);
```

Rename the existing tools to the regularized names (`outline_file`→`view_outline`, `outline_symbol`→`view_members`, `outline_function`→`view_body`, `search`→`find_symbol`, `definition`→`find_def`, `usages`→`find_refs`, `implementations`→`find_impls`, `calls`→`find_callers`/`find_callees` split, `surface`→`exports`). For the calls split, register `find_callers` (direction incoming) and `find_callees` (direction outgoing) as two tools.

Then register the OLD names as aliases pointing at the same handlers (call `server.registerTool` again with the old name + same handler) for: `outline_file`, `outline_symbol`, `outline_function`, `search`, `definition`, `usages`, `calls`, `implementations`, `surface`. Keep `resolve`, `imports`, `usage_report` (and add `usage_report` stays the dead-code report) as-is.

- [ ] **Step 4: Run, verify PASS** (`pnpm build`, `pnpm exec nadle test`).

- [ ] **Step 5: Check + commit**

```bash
git add packages/mcp/src/index.ts packages/mcp/src/__tests__/mcp.test.ts
git commit -m "Regularize MCP tool names + add view_symbol/region/context"
```

---

## Task 6: README + final verification

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Update the README** Usage section to the new command names (CLI `view`/`find` families, the new ops) and the MCP tool list. Add a short "Renamed commands" note mapping old → new (outline-file → view outline, search → find symbol, surface → exports, calls → find callers/callees, def/refs/impls → find def/refs/impls) and that old names remain as aliases.

- [ ] **Step 2: Full verification**

Run:

```bash
pnpm build
KESTREL_REQUIRE_LSP=1 pnpm exec nadle testCoverage
pnpm exec nadle check
```

Expected: all pass; coverage thresholds (lines/functions/statements 80, branches 70) hold.

- [ ] **Step 3: Commit + push + PR**

```bash
git add README.md
git commit -m "Document the view/find command redesign"
git push -u origin feat/cli-redesign
```

Open a PR titled "Redesign CLI into view/find families + source-reading ops", body summarizing the new commands, the three new ops, and the aliases; note "Closes" for any tracked issue (this implements the agent-file-read use cases; reference the spec). Let CI run all three OS.

---

## Self-review notes

- **Spec coverage:** view outline/file/symbol/members/body/region/context (T1 symbol, T2 region, T3 context, T4 CLI) ✓; find symbol/def/refs/impls/callers/callees (T4) ✓; top-level resolve/imports/exports/usage (T4) ✓; MCP regularized + new + aliases (T5) ✓; aliases (T4 CLI + T5 MCP) ✓; new result types (T1-3) ✓; README (T6) ✓.
- **Type consistency:** `SourceResult`, `RegionResult`, `SymbolContext` defined in T1/T2/T3 and used identically in engine + lsp-engine + create-engine + CLI + MCP. `symbolSource`/`readRegion`/`symbolContext` signatures identical across the interface, both engines, and the async bridge.
- **Engine semantics unchanged:** refs/surface/callHierarchy logic untouched — only names/grouping + the 3 new read ops + composition in symbolContext.
- **No placeholders:** every code step has full code; the only "match the existing helper" notes are for the CLI/MCP test files whose exact helper names the implementer reads first (real files, present today).
- **YAGNI:** view context is fixed-shape (no flags); no rename/modify ops; aliases are the same command objects, not duplicated logic.
