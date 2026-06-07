# CLI command redesign — `view` / `find` families + source-reading ops

Date: 2026-06-07

Redesign kestrel's CLI (and MCP tool names) around what an AI agent actually does with code:
**read it** (`view`) and **locate/trace symbols** (`find`), plus a few top-level addressing /
whole-file facts. Adds the missing "read actual source by address" ops — the biggest gap
today — without churning the proven query engine. ts-morph stays the default engine; every
`--engine lsp` path keeps working.

## Motivation

The current CLI is 12 flat commands with mixed naming (`def` vs `outline-file` vs
`outline-fn`) and **no way to read a symbol's source**. An agent that wants one function's body
re-reads the whole file or computes line offsets — exactly the token waste kestrel exists to
remove. This redesign groups by agent intent, regularizes names, and adds source-reading.

## The command set

Invocation: `kestrel <command> [subcommand] <target> --tsconfig <path> [--engine tsmorph|lsp]`.

### `view` — read code (structure + source)

| Subcommand     | Target         | Output                                                          | Status                     |
| -------------- | -------------- | --------------------------------------------------------------- | -------------------------- |
| `view outline` | `<file>`       | structural TOC (compact tree; `--json` full)                    | rename of `outline-file`   |
| `view file`    | `<file>`       | token-lean whole file: outline by default, `--body` adds source | NEW                        |
| `view symbol`  | `<file:Name>`  | exact source of a declaration (signature + body)                | NEW                        |
| `view members` | `<file:Name>`  | members of a class/interface/namespace                          | rename of `outline-symbol` |
| `view body`    | `<file:Name>`  | function statement skeleton (`--depth`)                         | rename of `outline-fn`     |
| `view region`  | `<file:L1-L2>` | an addressed line range, verbatim                               | NEW                        |
| `view context` | `<file:Name>`  | signature + body + resolved callees + referenced types          | NEW (differentiator)       |

### `find` — locate + trace

| Subcommand     | Target        | Output                                                                     | Status                 |
| -------------- | ------------- | -------------------------------------------------------------------------- | ---------------------- |
| `find symbol`  | `<name>`      | repo-wide search (`--contains`)                                            | rename of `search`     |
| `find def`     | `<file:Name>` | declaration site(s)                                                        | rename of `def`        |
| `find refs`    | `<file:Name>` | usages, classified (`--context`, `--exclude-tests`, `--limit`, `--cursor`) | rename of `refs`       |
| `find impls`   | `<file:Name>` | implementors of an interface                                               | rename of `impls`      |
| `find callers` | `<file:Name>` | incoming call hierarchy (`--depth`)                                        | was `calls` (incoming) |
| `find callees` | `<file:Name>` | outgoing call hierarchy (`--depth`)                                        | was `calls --outgoing` |

### top-level — addressing + whole-file facts

| Command   | Target        | Output                                         | Status              |
| --------- | ------------- | ---------------------------------------------- | ------------------- |
| `resolve` | `<file:Name>` | name → symbol \| candidates \| not-found       | unchanged           |
| `imports` | `<file>`      | import statements                              | unchanged           |
| `exports` | `<file>`      | transitive public surface (expands `export *`) | rename of `surface` |
| `usage`   | `<file>`      | per-export reference-count / dead-code report  | unchanged           |

Total: 7 `view` + 6 `find` + 4 top-level = **17 commands**.

## New ops — semantics

These three are the value of the redesign; the rest are renames/regroupings of existing core
ops.

### `view symbol <file:Name>`

Resolve the symbol, return its **exact declaration source** (from the declaration's start to
its end, including the leading signature and body). Output: `{ qualifiedName, position,
source }`. For overloaded/merged declarations, return each declaration's source in order.
Implemented in core as `Engine.symbolSource(symbol)` / `LspEngine.symbolSource` (parser-based
on the LSP side — it already parses for outline). No new LSP round-trip.

### `view region <file:L1-L2>`

Pure text slice: lines L1–L2 (1-based, inclusive) of the file, returned verbatim with the
`{ file, startLine, endLine, source }` envelope. No symbol resolution. A name-free addressing
primitive so an agent never falls back to a raw file read with computed offsets. Validates the
range against the file length; clear error if out of range. Lives in core as a small
`readRegion(file, start, end)` (engine-independent — it reads the file).

### `view context <file:Name>`

The synthesized op a bridge can't produce in one call. Composes existing ops:

```
{
  qualifiedName, position,
  signature,                 // the declaration head (up to the body)
  source,                    // full declaration source (= view symbol)
  callees:  Candidate[],     // symbols this declaration calls (outgoing call hierarchy, depth 1)
  typeRefs: Candidate[]      // named types referenced in the signature/body
}
```

Built from `findDefinition` + `symbolSource` + `callHierarchy(outgoing, depth 1)` + a type-ref
pass. The type-ref pass is syntactic: walk the declaration's AST for `TypeReference` names and
report the distinct ones (best-effort identity, not full type resolution — names, not where
each resolves). Depth and which sections to include are fixed for v1 (no flags) to keep it one
call. If a section is empty (e.g. no callees), it is returned as an empty array, not omitted.

## Architecture

- **Core** gains: `symbolSource(symbol): SourceResult[]`, `readRegion(file, l1, l2):
RegionResult`, `symbolContext(symbol): SymbolContext`. All three added to the `SymbolEngine`
  interface (and the async `LspEngine`). New result types in `types.ts`.
- **CLI** (`packages/cli`): restructure into `view` and `find` parent commands (citty
  `subCommands`), each with the subcommands above; `resolve`/`imports`/`exports`/`usage` stay
  top-level. Shared `--tsconfig` / `--engine` args as today.
- **MCP** (`packages/mcp`): tool names regularized to match — `view_outline`, `view_symbol`,
  `view_region`, `view_context`, `view_members`, `view_body`, `view_file`, `find_symbol`,
  `find_def`, `find_refs`, `find_impls`, `find_callers`, `find_callees`, `resolve`, `imports`,
  `exports`, `usage`.

## Back-compat

The CLI is pre-1.0 (`0.1.0`) and unpublished, so this is the moment to regularize. Still, to
avoid breaking the scripts/docs that exist:

- Keep the old flat CLI names (`outline-file`, `outline-symbol`, `outline-fn`, `search`, `def`,
  `refs`, `impls`, `calls`, `surface`) as **hidden aliases** that map to the new commands.
  `calls` aliases `find callers`; `calls --outgoing` maps to `find callees`.
- MCP: keep the old tool names registered as aliases alongside the new ones for one release.
- README + docs updated to the new names; a short "renamed commands" note added.

## Error handling

- `view region` out-of-range or `L1 > L2` → clear error naming the file + valid line bounds.
- `view symbol`/`members`/`body`/`context` on a not-found/ambiguous name → same `resolve`
  result surfaced (candidates or not-found), not a stack trace (existing `runSafe` behavior).
- All commands keep the clean-error contract (no stack traces; non-zero exit).

## Testing

- Core: unit + parity tests for `symbolSource`, `readRegion`, `symbolContext` on both engines
  against the synthetic fixtures (a class with a body, an overloaded fn, a namespace member,
  an out-of-range region).
- CLI: integration tests (spawn the built binary) for one command per family + an alias
  (`outline-file` still works; `view outline` works; `find callees` == `calls --outgoing`).
- MCP: a tool-list assertion (new names present) + one `view_symbol` / `view_context` call.
- All `--engine lsp` paths gated on tsgo availability as today; CI runs them.

## Non-goals

- No change to the query _semantics_ (refs classification, surface expansion, call hierarchy
  depth) — only names/grouping + the three new read ops.
- No `view context` configurability in v1 (fixed sections); revisit if agents need it.
- rename/modify ops remain out of scope (read-only v1).
