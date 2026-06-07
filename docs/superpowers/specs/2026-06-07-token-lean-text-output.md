# Token-lean text output by default (RTK-style)

Date: 2026-06-07

Make every kestrel op emit **dense, address-first text by default** across CLI and MCP, with
`--json` (CLI) / `json: true` (MCP) as the structured opt-in. This delivers the product's core
thesis — token-lean, agent-shaped output — which the current `JSON.stringify(_, null, 2)`
default betrays. `view outline` already does this (compact tree); this extends it to all ops.

## Why

JSON pretty-print taxes every result with braces, quotes, repeated keys, escaped newlines, and
indentation — hundreds of wasted tokens on structure the agent already knows. RTK's success is
exactly this lesson: strip what the model can re-derive, keep only signal, one line per fact.
kestrel's "fewer tokens than an LSP bridge" claim depends on the output layer being lean.

## Decisions (settled in brainstorming)

| Question                | Decision                                                                    |
| ----------------------- | --------------------------------------------------------------------------- |
| Scope                   | Text default **everywhere** (CLI + MCP); `--json` / `json:true` opt-in      |
| Position-row format     | `file:line:col<TAB>kind [extras]` — address first (re-feedable), tab-sep    |
| Symbol-row format       | `file:Name<TAB>kind [Lline]` — qualifiedName first (the next-query input)   |
| Hierarchy / multi-part  | indented tree (2 spaces/level) + labeled sections, per-op renderer          |
| Where renderers live    | `packages/core/src/render.ts`; adapters import + print; engine untouched    |

## Format vocabulary

**Address-first rule.** Each row leads with the token you'd paste into the next query:

- ops returning **locations** (`find refs`, `find def`, `find impls`) → `file:line:col`
- ops returning **symbols/candidates** (`find symbol`, `resolve` candidates) → `file:Name`

Fields after the lead are tab-separated; columns are NOT space-padded (tabs keep it lean and
still parseable by `split('\t')`). Empty/absent fields are omitted.

### Per-op formats

`find refs` — one row per ref; test refs marked with a trailing `(test)`; `--context` appends
the snippet/block after a tab:

```
src/barrel.ts:1:18	re-export
src/consumer.ts:1:10	import
src/consumer.ts:6:21	call
src/e2e/usage.ts:4:25	call	(test)

36 refs (3 import, 30 call, ...)        # trailing summary line; pagination cursor noted if any
```

`find def` / `find impls` — `file:line:col<TAB>kind` rows (impls: the implementor name as
extra).

`find symbol` / `resolve` (candidates) — symbol rows:

```
src/shapes.ts:Circle	class	L5
src/shapes.ts:Circle	namespace	L5
```

`resolve` (single symbol) — one line: `file:Name	kind	L<line>`. `not-found` → `not found`
plus, if any, `did you mean: a, b, c`. Ambiguous → the candidate rows above.

`view outline` — unchanged (already the compact tree).

`view symbol` — header line + the verbatim source (REAL newlines, no escaping):

```
src/shapes.ts:12:1	makeCircle
export function makeCircle(radius: number): Circle {
	return new Circle(radius);
}
```

Multiple declarations: repeat header+source separated by a blank line.

`view region` — header `file:Lstart-Lend` then the verbatim slice.

`view members` / `view body` — indented rows (member name `<TAB>` kind `<TAB>` `L<line>`;
body = the statement-kind tree, 2-space indent per depth).

`view context` — labeled sections:

```
src/consumer.ts:3:1	totalArea
sig: export function totalArea(count: number): number
types: Circle
callees:
  src/shapes.ts:12:17	makeCircle
  src/shapes.ts:7:2	area
---
export function totalArea(count: number): number {
	...
}
```

`callHierarchy` (`find callers` / `find callees`) — indented tree, address + name per node:

```
totalArea	src/consumer.ts:3:1
  averageArea	src/consumer.ts:12:14
    AreaService.compute	src/consumer.ts:22:9
```

`imports` — `module<TAB>named (a, b)<TAB>default? namespace?` per import.

`exports` — symbol rows (`file:Name	kind`).

`usage` (report) — aligned rows: `file:Name	total=N consumed=M	kind`.

## Architecture

- **`packages/core/src/render.ts`** gains one pure function per op:
  `renderReferences(UsagesResult)`, `renderCandidates(Candidate[])`, `renderResolve(ResolveResult)`,
  `renderHandles(SymbolHandle[], label)` (def/impls), `renderSource(SourceResult[])`,
  `renderRegion(RegionResult)`, `renderMembers(Member[])`, `renderStatements(StatementNode[])`,
  `renderContext(SymbolContext)`, `renderCallHierarchy(CallNode[])`, `renderImports(ImportInfo[])`,
  `renderUsageReport(UsageReportEntry[])`, plus the existing `renderFileOutline`. Each is
  `struct -> string`, deterministic, no engine access. Tested in isolation.
- **Core stays data-only**: engines still return the structured types; `render.ts` is a
  separate presentation module that core re-exports. (This deliberately keeps a render layer in
  core — superseding issue #43's "move render out" concern: one shared renderer beats two
  drifting copies in the adapters, and core's render export is explicitly a public surface.)
- **CLI** (`packages/cli`): each command prints `render*(result)` by default; `--json` prints
  `JSON.stringify(result, null, 2)`. A single `--json` boolean is added to every command. The
  `emit()` helper becomes `output(result, render, json)` choosing text vs JSON.
- **MCP** (`packages/mcp`): each tool returns the rendered text in `content[0].text` by
  default; an optional `json: z.boolean()` arg returns the pretty JSON instead. (Both are
  already `text` content type; only the string differs.)

## Addressability is preserved

The address-first rule keeps every result re-feedable without JSON: an agent reads
`src/consumer.ts:6:21` or `src/shapes.ts:Circle` and pastes it into the next `view`/`find`.
This is the whole point — text loses nothing the agent needs, drops everything it doesn't.

## Error handling

- Renderers never throw — a malformed/empty struct renders to an empty string or a one-line
  marker (`(no results)`), never a crash. The CLI's `runSafe`/error path is unchanged.
- `--json` always available as the exact-structure escape hatch (debugging, programmatic use).

## Testing

- Unit-test each `render*` against fixed structs (snapshot or exact-string asserts) — table of
  input struct → expected text. Cover: empty result, single, multiple, nested (tree), test-ref
  marker, multi-declaration source, not-found/ambiguous resolve.
- CLI integration: one text-default assertion + one `--json` assertion per family (parses back
  to the struct). Assert the address-first token appears and is paste-shaped.
- MCP: a `json: true` call returns parseable JSON; default returns the text.
- Coverage thresholds hold (render.ts is highly testable pure code).

## Non-goals / supersedes

- Supersedes issue **#72** (`--text` flag) — text is now the default, so no separate flag.
- Engine semantics, addressing scheme, and op set are unchanged — this is purely the output
  layer.
- No color/ANSI (agents + pipes; keep it plain). No config file for format — one lean default,
  one `--json` escape.
