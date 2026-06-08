# kestrel — Design

Status: **in progress**. Section 1 (architecture) approved in session. Sections 2+ pending.
Reference: [VISION.md](./VISION.md).

## Approach (chosen): Warm core engine + thin adapters

Rejected alternatives:

- _Stateless spawn-per-query_ — rebuilds + typechecks every call; brutal cold-start per query.
- _Engine + SCIP hybrid_ — over-built; SCIP deferred.

## Section 1 — Architecture & layers (APPROVED)

```
packages/
  core/   # engine: warm ts-morph Project, query ops, formatting. Transport-agnostic.
  mcp/    # MCP server adapter — keeps core warm across tool calls
  cli/    # CLI adapter — daemon (warm) or one-shot (cold)
```

- **core** owns: project loading, symbol resolution (qualified-name → ts-morph Symbol),
  query ops, output formatting. Read-only in v1 — no write path. Knows nothing about MCP or CLI.
- **mcp** / **cli** are thin: translate transport ↔ core calls. No analysis logic.

Data flow:

```
adapter -> core.refreshIfStale() -> core.resolveSymbol(name) -> core.query -> formatted result -> adapter serializes
```

## Section 2 — Core API surface (PENDING)

Sketch (not yet approved) — read-only:

- `resolveSymbol(qualifiedName) -> Symbol | Candidate[]` (ambiguity → candidates w/ positions)
- `findUsages(symbol, { context, limit, cursor })` — bounded result set
- `findImplementations(symbol)`
- `findDefinition(symbol)`
- `outlineFile(path) -> { exports, classes, interfaces, functions }` w/ signatures + positions
- `outlineSymbol(symbol) -> Member[]` — class/interface/namespace members + signatures
- `outlineFunction(symbol, { depth }) -> StatementNode[]` — deterministic body skeleton
  (declarations, loops, conditionals, calls, returns + positions); `depth` controls nesting
- `searchSymbol(name, { contains }) -> Candidate[]` — repo-wide name search
- `listImports(path) -> ImportInfo[]` — a file's import statements (module wiring)
- `callHierarchy(symbol, { direction, depth }) -> CallNode[]` — incoming callers / outgoing callees
- dependency-graph queries (vision-level, design TBD)

All outline ops = deterministic AST walks (ts-morph). No LLM (see VISION anti-goal).

`rename` / `move` removed — modification deferred (see VISION "Out of scope").

## Open design questions (next session)

1. Symbol resolution algorithm — qualified-name grammar, specified in
   [ADDRESSING.md](./ADDRESSING.md). DONE: `::`-separated namespace
   paths (`file:Model::Inner::Node`), bare-segment match at any depth → path candidates,
   `#index` for same-path collisions. The `::` separator (not `.`) keeps quoted, dotted
   module names (`"@scope.org/pkg"`) intact. Still open: overloads, generics, default/anonymous export,
   declaration-merged across files, re-exports.
2. Warm-lifecycle: how MCP holds the Project; CLI daemon protocol vs cold one-shot.
3. Output schema — minimal default record; `--context=none|snippet|block` shape; result-set
   bounding (limit/cursor/count-only).
4. Error handling — symbol-not-found, ambiguous, out-of-project-scope.
5. Monorepo / multi-tsconfig — which Project resolves a given symbol; project references.
6. Concurrency — MCP concurrent queries on one mutable Project (ts-morph caches on read,
   not reentrant); serialize vs isolate. See Section 3.
7. Outline schema — statement kinds surfaced by `outlineFunction` (loop/if/switch/try/call/
   return/decl?), nesting/`depth` model, where it stops; file/symbol outline record shape.
8. Testing strategy.

## Section 3 — Performance & non-functional (PENDING)

The dominant risk class for a read-only v1. Targets + mitigations to decide:

- **Cold start.** Full load + typecheck on first query. Budget? Mitigations: warm core (MCP
  holds `Project`), `skipLoadingLibFiles` where safe, scope to relevant tsconfig only.
- **Incremental refresh (hot path).** Agent edits out-of-band between queries. Re-reading a
  `SourceFile` is cheap; re-typechecking the dependent graph is not. Decide: refresh-on-demand
  per query vs fs-watch vs agent-signals-change. Measure invalidation cost.
- **Large reference sets.** `findUsages` on common symbols → thousands of hits. Cap + paginate
  (`limit`/`cursor`), offer count-only. Protects latency _and_ agent token budget.
- **Memory.** Warm `Project` = full AST + types in RAM, GB-scale on big repos; long-lived MCP
  process. Decide eviction/budget, lib-file loading tradeoff.
- **Concurrency.** Serialize queries on the shared Project (cheap, read-only) — see open-Q6.

## Naming

Name: **kestrel** (chosen 2026-06-06).
