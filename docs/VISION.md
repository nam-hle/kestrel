# symantic — Vision

> Semantic symbol intelligence (read/analyse) for TypeScript, shaped for AI agents.

Status: **early development — read-only core engine + CLI + MCP server all working.**
Originally captured from a design session on 2026-06-06 and kept current as the read path
ships. This document is the source of truth for _what we are building and why_. Architecture
detail lives in [DESIGN.md](./DESIGN.md); the values that adjudicate tradeoffs live in
[PRINCIPLES.md](./PRINCIPLES.md); the addressing scheme in [ADDRESSING.md](./ADDRESSING.md).

## One-line

symantic is a tool an AI agent invokes to ask "where is symbol X used / what implements X /
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

symantic closes that gap. We **borrow** the semantic engine; we **build** the agent ergonomics.

## What it is (and is not)

**Primary job (v1):** query / analyse only. Read-grade. Modification (rename/move) is
**deferred** — see "Out of scope". v1 answers questions; it does not change code.

**Consumers:** AI agents. Shipped as a **shared core engine** with **two thin front-ends**:
an **MCP server** (native agent tools, JSON) and a **CLI** (`tool refs Foo --json`).

## Decisions (locked this session)

| #                 | Decision                         | Choice                                                                                 |
| ----------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| Primary job       | query vs modify vs context       | **Query / analyse only** (modify deferred)                                             |
| Integration       | MCP / CLI / both / lib           | **Both** — shared core, MCP + CLI adapters                                             |
| Freshness         | live / indexed / incremental     | **Live in-memory** ts-morph `Project`, re-read files changed out-of-band before query  |
| Symbol addressing | qualified-name / position / both | **Qualified name** (`file.ts:MyClass::method`, `IFoo`); on ambiguity return candidates |
| Output detail     | minimal / snippet / block        | **Minimal by default** (`file:line:col` + kind); snippet/block via flag                |
| Architecture      | stateless / warm-core / hybrid   | **Warm core engine + thin adapters**                                                   |

## In scope — read/analyse only (shipped)

Ops are grouped by intent under two CLI verbs — `view` (read code) and `find` (locate /
trace) — plus top-level `resolve` / `imports` / `exports` / `usage`. (MCP exposes the same set
as `view_*` / `find_*` tools.)

- `find refs <sym>` — all references, classified by kind (call / import / type-ref / read /
  write), capped + paginated.
- `find impls <sym>` — implementors of an interface / abstract.
- `find def <sym>` — declaration site(s); handles declaration merging.
- `find callers` / `find callees <sym>` — incoming / outgoing call hierarchy, bounded depth.
- `find symbol <name>` — repo-wide search (`--contains` for substring); the orientation entry
  point when the file is unknown.
- `view outline <file>` — file structure: declarations (incl. nested) + re-exports, in source
  order. Token-lean "table of contents".
- `view members <sym>` — members of a class / interface / namespace (folds declaration merges).
- `view body <sym>` — statement-level skeleton of a function body (`--source` for the code).
- `view context <sym>` — source + signature + resolved callees + referenced types (the former
  `get_symbol_context`, promoted from vision-level once the outline ops proved out).
- `view symbol` / `view region` / `view file` — exact source of a declaration / a line range /
  a whole file.
- `imports` / `exports <file>` — a file's imports / transitive public surface (expands
  `export *`); `usage <file>` — per-export reference counts (dead-code in one call).
- Output: token-lean, address-first text by default; `--json` for structured form;
  `--context=none|snippet|block` on references.
- Qualified-name addressing; ambiguity → candidate list with positions.
- Result-set bounding: cap + paginate large reference sets, count-only mode (token-lean).

All read-only: symantic never writes files. **Dependency-graph** queries remain vision-level.

## Out of scope

Deferred (revisit once read path proven):

- **Modification — `rename` / `move`** (was v1). Reintroduces atomic-apply, rollback,
  stale-AST-vs-disk, and move-semantics (barrels / `paths` aliases / cycles) risk classes.
- Signature change / extract / inline refactors; generic agent-described codemods.

Never (anti-goal):

- **LLM inside symantic.** symantic outputs are deterministic, compiler-derived. Prose summaries
  / "what does this do" are the calling agent's job — symantic hands it exact structure, the
  agent (already an LLM) interprets. `outline_function` is a _structural_ skeleton, not prose.

Deferred — possibly forever:

- Multi-language. TS/JS only; LSP-generalize is a different product (agent-lsp territory).
  JS without types degrades toward textual accuracy — TS is the accuracy promise.
- SCIP indexing / persistence (live-only).
- Cross-session daemon persistence (warmth is per-process/session).

## Engine roadmap — ts-morph now, Go (tsgo) next

The core is **transport-agnostic and engine-agnostic by design** (core ↔ adapters split in
DESIGN). The analysis engine sits behind `resolveSymbol` / `findUsages` and is swappable.

- **Default engine: ts-morph** (TypeScript compiler API, Node). Mature, exact, `findReferences()`
  / `getImplementations()` ship today. Matches the thesis: borrow proven semantics, build
  ergonomics. Cost = Node runtime + cold-start/typecheck latency (see Key risks).
- **Opt-in engine: tsgo (Go), shipped as `--engine lsp`** — Microsoft's native port of the
  TypeScript compiler (`typescript-go`), faster on the hot path, driven over LSP. It is the
  cold-start / perf escape hatch: same compiler-accurate semantics, native speed. Wired behind
  the same core interface and selectable today via `--engine lsp` (CLI) / `engine: "lsp"` (MCP),
  with `@typescript/native-preview` as an _optional_ dependency. Still preview-grade — the
  ts-morph engine stays the default until tsgo's embeddable API stabilizes; parity gaps fall
  back to the default. Endgame: tsgo as the default once it GAs with a stable API.
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
