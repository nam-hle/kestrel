# LspEngine (Door 3) — design

Date: 2026-06-07 · Branch: `feature/door3-lsp-engine`

An opt-in engine backed by **tsgo's LSP server** for semantic ops, with a thin
TypeScript-native parser for syntactic ops. Implements the same surface as the ts-morph
`Engine`, output-translated to kestrel's name-addressed / token-lean contract. ts-morph stays
the default. See [TSGO-SPIKE.md](../../TSGO-SPIKE.md) (Door 3 spike: PASS) and
[ROADMAP.md](../../ROADMAP.md) (deferred-engine entry).

## Decisions (settled in brainstorming)

| Question | Decision |
| --- | --- |
| Addressing bridge (`file:Name` → position) | **tsgo `documentSymbol`** — no second engine for resolution |
| Packaging | Same package (`packages/core`), opt-in; ts-morph default |
| Op scope | **Full parity** — all 13 ops |
| Ops LSP can't serve (imports, outline detail, fn bodies) | **Light parser** — `typescript` native `ts.createSourceFile` |
| Parser choice | `typescript` package, raw AST (not ts-morph) |
| Subprocess lifecycle | **Lazy**, one tsgo per engine, warm for lifetime, killed on `dispose()` / exit |

## Architecture

Three new modules in `packages/core/src`:

```
symbol-engine.ts   shared interface both engines implement (extracted from Engine's shape)
lsp-engine.ts      LspEngine: tsgo subprocess + parser, translates to kestrel types
lsp/
  client.ts        LSP transport: spawn tsgo, JSON-RPC over stdio, request/notify
  bridge.ts        documentSymbol walk: file:Name (dotted) -> LSP position
  translate.ts     LSP Location/SymbolInformation -> kestrel Position/SymbolHandle/Reference
  syntactic.ts     ts.createSourceFile walkers: imports, outline, function bodies
```

`Engine` (ts-morph) is unchanged. `index.ts` additionally exports `LspEngine`, `SymbolEngine`.

### `SymbolEngine` interface

Extracted from the current `Engine` public method shapes (resolveSymbol, searchSymbol,
findDefinition, findUsages, findImplementations, callHierarchy, outlineFile, outlineSymbol,
outlineFunction, listImports, publicSurface, usageReport, refreshIfStale). Both `Engine` and
`LspEngine` implement it. `Engine` gains the interface declaration only — no behavior change.
`LspEngine` adds `dispose(): Promise<void>` (not on the interface; tsgo-specific cleanup).

## The addressing bridge (the key design choice)

`file:Name` where Name is dotted (`Shape`, `NS.Inner.Type`, `Type.method`), with optional
`#index` for same-path collisions — kestrel's existing scheme (`parseQualifiedName`).

Resolution via tsgo, no ts-morph:

1. `textDocument/didOpen` the file (idempotent; track opened set).
2. `textDocument/documentSymbol` → hierarchical `DocumentSymbol[]` (tsgo returns the nested
   form; each has `name`, `kind`, `range`, `selectionRange`, `children`).
3. Walk the tree by the dotted segments: top segment matches a root symbol, each subsequent
   segment matches a child. A bare single segment matches at any depth (mirrors current
   `findDeclarationsThroughReExports` "bare segment matches at any depth").
4. `selectionRange.start` is the position for LSP semantic requests (points at the name token).
5. `#index` selects among multiple same-path matches; >1 match and no index → `ambiguous`
   (same contract as today).

**Known fidelity gap vs ts-morph, documented not hidden:** `documentSymbol` sees only a
file's own declarations. It does NOT follow re-export chains or `export *`. Two consequences:

- `resolveSymbol` on a symbol that lives behind a barrel re-export: `LspEngine` falls back to
  `workspaceSymbol` (name search across the project) then `textDocument/definition` to land on
  the true declaration. Covered by a test mirroring the ts-morph re-export fixtures.
- `publicSurface` (`export *` expansion): walk the entry file's `export` nodes via the parser
  to get re-exported module specifiers, resolve each via `definition`. Multi-call; acceptable.

## Op → mechanism map

| Op | Mechanism |
| --- | --- |
| resolveSymbol | documentSymbol bridge (+ workspaceSymbol/definition fallback for re-exports) |
| searchSymbol | `workspace/symbol` |
| findDefinition | `textDocument/definition` |
| findUsages | `textDocument/references` (+ kind classification, see below) |
| findImplementations | `textDocument/implementation` |
| callHierarchy | `callHierarchy/prepare` → `incomingCalls`/`outgoingCalls`, bounded depth walk |
| outlineFile | parser (`ts.createSourceFile`) — buckets, signatures, typeParameters, exported flag |
| outlineSymbol | parser — members of a class/interface/namespace |
| outlineFunction | parser — statement skeleton of a body (LSP can't descend into bodies) |
| listImports | parser — import declarations |
| publicSurface | parser (find re-exports) + `definition` to resolve true decls |
| usageReport | publicSurface + findUsages loop (composed, same as today) |
| refreshIfStale | re-`didOpen` changed files (LSP `didChange` or close+open) |

### Reference-kind classification

kestrel tags each usage `call | import | re-export | type-ref | read | write`. LSP
`references` returns bare locations — no kind. `LspEngine` classifies by parsing each
referenced file at the returned position and inspecting the node context (reuse the logic
shape of `usages.ts:classifyReference`, ported to raw TS AST). Tested against the existing
`classify.test.ts` expectations.

## LSP transport (`lsp/client.ts`)

From the spike (proven): spawn the `tsgo` bin from `@typescript/native-preview` with
`--lsp --stdio`; Content-Length framing + JSON-RPC. **Must answer the server's
`workspace/configuration` and `client/registerCapability` requests** or the handshake hangs
(spike caught this). Handshake: `initialize` → answer server→client requests → `initialized`.

Lifecycle: lazy spawn on first semantic op; warm for engine lifetime; `dispose()` sends
`shutdown` + `exit` then kills the child. Register a `process` exit handler so a forgotten
`dispose()` doesn't leak the child. Syntactic-only usage never spawns tsgo.

## Translation (`lsp/translate.ts`)

- LSP `uri` (`file://<root>/...`) → strip to relative path against the project root.
- LSP 0-based `line`/`character` → kestrel 1-based `line`/`col`.
- Byte offsets / LSP positions never leave the adapter — the public surface stays `file:Name`
  + 1-based `Position`, identical to the ts-morph engine.

## Error handling

- File not in project / not opened → same `file not found in project: …` error string as
  `Engine.#requireSourceFile`, for caller parity.
- tsgo spawn failure (bin missing) → clear error naming `@typescript/native-preview`.
- LSP request timeout → reject with the op + symbol in the message; don't hang.
- Name not found in documentSymbol tree → `not-found` (with parser-derived `nearestNames`
  suggestions, reusing the Levenshtein helper against parsed symbol names).

## Testing (TDD, per project convention)

Reuse the existing synthetic fixtures (`src/__tests__/fixtures/sample`) — NO company code.
New suites under `__tests__`, engine-parametrized where practical so the same assertions run
against both engines:

- `lsp/bridge` — dotted-path + bare-segment + `#index` resolution from a documentSymbol tree.
- `lsp/translate` — uri→relative, 0-based→1-based, fixtures with nested dirs.
- `lsp/syntactic` — imports, outline buckets, function skeleton vs the ts-morph engine's
  output on the same fixtures (parity assertions).
- `lsp-engine` integration — def/refs/impls/callHierarchy against fixtures, asserted equal to
  the ts-morph engine's results (the spike already showed `makeCircle` refs match).
- re-export + `export *` fidelity — the barrel/publicSurface cases, proving the fallback path.

Integration tests spawn real tsgo (the dep is already installable; spike used it). Gate them
so they skip cleanly if the bin is absent, but run in CI where the dep is present.

## Non-goals / deferred

- rename / modify ops (tsgo advertises `renameProvider`; out of read-only v1).
- Multiple tsgo processes / pooling — one per engine is enough now.
- Benchmark numbers — separate task ([BENCHMARK.md](../../BENCHMARK.md) Phase 0); this build
  only needs to feed it a working second engine.

## Don'ts (carried from handoff)

- Don't reimplement refs/impls on the raw tsgo Checker (the Door 2 trap).
- Don't break or modify the ts-morph `Engine` — Door 3 is purely additive/opt-in.
- Don't copy company/A12 code into fixtures — synthetic only; real repos queried live.
