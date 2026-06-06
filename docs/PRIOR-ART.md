# Prior Art — symbol-usage / refactor tooling

Survey informing kestrel. Web research (2026-06-06); claims cited, not adversarially
verified. Tiered by **accuracy** (semantic vs textual) and **agent-fit**.

## Semantic / type-aware (highest accuracy)

- **TypeScript compiler API / tsserver** — source of truth. `tsserver` = long-running Node
  process, line-delimited JSON protocol; supports find-all-references (cross-project) +
  call hierarchy. Stateful, awkward for one-shot CLI.
  https://deepwiki.com/microsoft/TypeScript/5-language-server-(tsserver)
- **ts-morph** — OO wrapper over the compiler API. `symbol.findReferences()`,
  `getImplementations()`, `getDefinitions()`. **Best embeddable engine for a Node tool.**
  Chosen for kestrel v1. https://ts-morph.com/ · https://www.npmjs.com/package/ts-morph
- **scip-typescript** — Sourcegraph indexer on the TS typechecker. Compiler-accurate
  def/refs incl. package.json deps; 1k-5k LOC/s. Produces offline SCIP index — good for
  read-heavy, bad when agent mutates between queries. Deferred for us.
  https://sourcegraph.com/blog/announcing-scip-typescript · https://scip-code.org/
- **typescript-go / tsgo (Go)** — Microsoft's native port of the TS compiler ("Corsa").
  ~10x faster typecheck; embeddable programmatic API (`@typescript/api`) + LSP (completions,
  diagnostics, navigation, refs). Currently preview. Compiler-accurate, native speed, no Node
  warm-up. **kestrel's vision engine** (cold-start escape hatch) once GA + stable embeddable
  find-references confirmed. https://github.com/microsoft/typescript-go

## Rust semantic tier — not viable (surveyed, rejected)

- **stc** (dudykr) — was a tsc-compatible TS type checker in Rust. **Archived/abandoned**
  (2025-03-12, read-only). Dead. https://github.com/dudykr/stc
- **ezno** (kaleidawave) — fast Rust TS checker, own type system, partial TS coverage; not
  tsc-compatible, research-grade, no stable embeddable refs API. https://github.com/kaleidawave/ezno
- **tsz** — Rust TS compiler/checker/LSP aiming tsc-compat; immature, not at parity. https://tsz.dev/
- **SWC / oxc** — Rust parsers/transpilers (fast AST), **syntactic only — no typechecker**,
  so no type-aware references. Fallback-sweep tier, not semantic core.

Takeaway: Rust has great *syntactic* TS tooling, no usable *semantic* (typechecker) tier.
Native-speed semantics = **Go (tsgo)**, not Rust. Going pure-Rust = building a typechecker.

## LSP-bridge MCP servers (agent-native, semantic)

- **lsp-mcp** — MCP↔LSP bridge. Tools `lsp_definition`, `lsp_references`, `lsp_hover`,
  `lsp_completion`. Langs via servers: gopls, typescript-language-server, pylsp, + any LSP.
  Output MCP JSON-RPC w/ file:line. https://github.com/mickeyinfoshan/lsp-mcp
- **agent-lsp** — stateful MCP runtime over real language servers; 56 tools, 30+ langs,
  warm index, multi-step skills. Heavier, generic. https://www.agent-lsp.com/

These prove the agent pattern (precise findReferences beats grep) but are **multi-language
generic**, not TS-tuned, byte-offset addressed, verbose output. That's the gap kestrel targets.

## AST structural (syntactic — fast, no type info)

- **ast-grep** — Rust CLI, AST pattern match. TS/JS/Py/Java/Rust+. `--json=pretty|stream|compact`.
  Finds usage + imports, rewrites via templates. Fast, but **syntactic** — can't disambiguate
  same-name by type. Good fallback tier. https://github.com/ast-grep/ast-grep
- **comby** — structural search/replace ~every language. https://comby.dev/
- **GritQL** — query lang, powers Biome plugins.

## Dependency-graph (file/module level)

- **dependency-cruiser** — JS/TS import graph; json/mermaid/dot/csv/html; rule validation.
  https://github.com/sverweij/dependency-cruiser
- **madge** — module dep graph, circular detection; JSON/DOT/text. https://github.com/pahen/madge

## Tags / textual (lowest accuracy, universal)

- **universal-ctags** — definitions index, no real references. https://github.com/universal-ctags/ctags
- **ripgrep** — text grep, zero semantics. Baseline fallback.

## Takeaway for kestrel

Engine: **ts-morph** (live, semantic) for v1; **tsgo (Go)** the perf successor once GA.
Optional syntactic fallback: **ast-grep**. File-level: **dependency-cruiser**. Build value =
agent ergonomics layer, not the analysis engine.
