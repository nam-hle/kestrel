# kestrel — Vision

> Semantic symbol intelligence (read/analyse) for TypeScript, shaped for AI agents.

Status: **vision / pre-implementation**. Captured from a design session on 2026-06-06.
This document is the source of truth for _what we are building and why_. Architecture
detail lives in [DESIGN.md](./DESIGN.md) (in progress).

## One-line

kestrel is a tool an AI agent invokes to ask "where is symbol X used / what implements X /
where is it defined" with **compiler-accurate** semantics, returning token-lean,
name-addressed results.

## Problem

AI coding agents currently answer "how is this symbol used" with `grep` / ripgrep —
**textual**, not semantic. Same-named symbols, overloads, shadowing, type-only references
all produce false hits or misses.

The semantic engine to do this correctly already exists (TypeScript compiler / typechecker,
wrapped by ts-morph). The gap is **not semantics** — it is **agent-shaped packaging**:
existing tools use byte offsets (agents have no cursor), emit verbose LSP payloads (burns
tokens), and aren't tuned for an agent's query loop.

kestrel closes that gap. We **borrow** the semantic engine; we **build** the agent ergonomics.

## What it is (and is not)

**Primary job (v1):** query / analyse only. Read-grade. Modification (rename/move) is
**deferred** — see "Out of scope". v1 answers questions; it does not change code.

**Consumers:** AI agents. Shipped as a **shared core engine** with **two thin front-ends**:
an **MCP server** (native agent tools, JSON) and a **CLI** (`tool refs Foo --json`).

## Decisions (locked this session)

| #                 | Decision                         | Choice                                                                                |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| Primary job       | query vs modify vs context       | **Query / analyse only** (modify deferred)                                            |
| Integration       | MCP / CLI / both / lib           | **Both** — shared core, MCP + CLI adapters                                            |
| Freshness         | live / indexed / incremental     | **Live in-memory** ts-morph `Project`, re-read files changed out-of-band before query |
| Symbol addressing | qualified-name / position / both | **Qualified name** (`file.ts:MyClass.method`, `IFoo`); on ambiguity return candidates |
| Output detail     | minimal / snippet / block        | **Minimal by default** (`file:line:col` + kind); snippet/block via flag               |
| Architecture      | stateless / warm-core / hybrid   | **Warm core engine + thin adapters**                                                  |

## In scope (v1) — read/analyse only

- `find_usages(symbol)` — all references: file:line:col + kind (call / import / type-ref).
- `find_implementations(symbol)` — implementors of interface / abstract.
- `find_definition(symbol)` — declaration site.
- `outline_file(path)` — structure of a file: exports, classes, interfaces, functions + their
  signatures and line positions. Deterministic AST walk; token-lean "table of contents".
- `outline_symbol(symbol)` — members of a class/interface/namespace (methods, props + signatures).
- `outline_function(symbol)` — deterministic statement-level skeleton of a function body:
  declarations, loops, conditionals, calls, returns (line positions). Expandable depth; no LLM.
- Output: minimal default, `--context=none|snippet|block` opt-in.
- Qualified-name addressing; ambiguity → candidate list with positions.
- Result-set bounding: cap + paginate large reference sets, count-only mode (token-lean).

All read-only: kestrel never writes files in v1.
**Call-hierarchy** and **dependency-graph** queries are vision-level (post-v1).

## Out of scope

Deferred (revisit once read path proven):

- **Modification — `rename` / `move`** (was v1). Reintroduces atomic-apply, rollback,
  stale-AST-vs-disk, and move-semantics (barrels / `paths` aliases / cycles) risk classes.
- Signature change / extract / inline refactors; generic agent-described codemods.
- **`get_symbol_context`** — deterministic context slice (signature + body + resolved callees
  - referenced types) for an agent to reason over. Extends the outline ops; vision-level.

Never (anti-goal):

- **LLM inside kestrel.** kestrel outputs are deterministic, compiler-derived. Prose summaries
  / "what does this do" are the calling agent's job — kestrel hands it exact structure, the
  agent (already an LLM) interprets. `outline_function` is a _structural_ skeleton, not prose.

Deferred — possibly forever:

- Multi-language. TS/JS only; LSP-generalize is a different product (agent-lsp territory).
  JS without types degrades toward textual accuracy — TS is the accuracy promise.
- SCIP indexing / persistence (live-only).
- Cross-session daemon persistence (warmth is per-process/session).

## Engine roadmap — ts-morph now, Go (tsgo) next

The core is **transport-agnostic and engine-agnostic by design** (core ↔ adapters split in
DESIGN). The analysis engine sits behind `resolveSymbol` / `findUsages` and is swappable.

- **v1 engine: ts-morph** (TypeScript compiler API, Node). Mature, exact, `findReferences()` /
  `getImplementations()` ship today. Matches the thesis: borrow proven semantics, build
  ergonomics. Cost = Node runtime + cold-start/typecheck latency (see Key risks).
- **Vision engine: tsgo (Go)** — Microsoft's native port of the TypeScript compiler
  (`typescript-go`), ~10x faster typecheck, embeddable programmatic API (`@typescript/api`)
  - LSP. Currently preview. This is kestrel's cold-start / perf escape hatch: same
    compiler-accurate semantics, native speed, no Node warm-up. Adopt once it GAs _and_
    exposes a stable embeddable find-references API. Likely
    shape: Go sidecar/binary behind the same core interface, or core itself reimplemented in Go.
- **Not Rust.** The Rust semantic-typechecker tier is not viable: STC (the tsc-compatible Rust
  checker) is **archived/abandoned** (2025); Ezno / tsz are research-grade, not at tsc parity.
  Rust TS tooling (SWC, oxc, ast-grep) is **syntactic only** — fast AST, no type-aware refs —
  usable as a fallback sweep tier, never the semantic core. Going Rust = rebuilding the
  typechecker = the exact thing this project refuses to do. Go (tsgo) gets native speed
  _without_ reinventing semantics.

## Key risks

- **Cold start.** ts-morph loads + typechecks the whole project on first call; big repos = slow
  first query. Mitigation: warm core holds `Project` in memory across calls (MCP keeps it warm;
  CLI daemon or accept cold one-shot). See DESIGN "Performance".
- **Staleness.** Agent edits files out-of-band (its own tools) between queries; in-memory
  `Project` goes stale → wrong answers. Read-only, so no corruption — but must detect changed
  files (mtime) and refresh before answering. The v1 guarantee = read-after-external-write
  consistency.
- **Large reference sets.** Common symbols have thousands of refs → slow + token blowout.
  Mitigation: cap, paginate, count-only mode.
- **Ambiguity.** Qualified names can collide (overloads/shadowing/re-exports). Tool returns
  candidates, never silently guesses.
