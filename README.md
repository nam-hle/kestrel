# kestrel

> Code navigation for TypeScript whose output is built for an agent's token budget and
> address model.

An AI agent has no cursor and a finite context window. kestrel answers code-navigation
questions ("where is X used / what implements it / what's the public surface here") with
results that are **name-addressed** (`file.ts:Class.method`, never a byte offset an agent
can't compute) and **token-lean** (a compact tree, not a verbose payload). Compiler-accurate
underneath (TypeScript via [ts-morph](https://ts-morph.com/)) — but accuracy is table stakes;
the **output contract is the point**.

**Status:** early development. Read-only core engine + CLI + MCP server all working.

## Why not just an LSP→MCP bridge?

Several tools already bridge a language server to MCP — they give compiler-accurate
references, implementations, even rename. But they pipe **raw LSP** through: byte-offset
positions (an agent has no cursor to resolve them) and verbose payloads (burning the context
window). They answer the question, then make the agent pay to parse and re-address the answer.

kestrel is the layer those bridges skip:

- **Name-addressing** — every result is a qualified name you feed straight into the next
  query. No offsets, no position bookkeeping.
- **Token-lean output** — compact tree outlines; classified, paginated refs; no LSP noise.
- **Synthesized ops with no LSP equivalent** — `outline_function` (statement skeleton),
  `public_surface` (transitively expands `export *`), bounded `call_hierarchy`,
  `usage_report` (dead-code in one call). A bridge wrapping a language server can't produce
  these by pass-through.

The engine (ts-morph today, maybe tsgo later) is commoditized. The output contract is the
durable part — see [docs/ROADMAP.md](docs/ROADMAP.md).

## What it does (v1, read-only)

| Operation             | Description                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `searchSymbol`        | repo-wide search for a name across all files (exact, or `--contains` substring) → candidates         |
| `resolveSymbol`       | `relPath:name` (dotted for nested namespaces, `name#index` to pick) → symbol or candidates           |
| `findDefinition`      | all declaration sites (handles declaration merging)                                                  |
| `findUsages`          | references classified by kind (import / call / type-ref / read / write), bounded by `limit`/`cursor` |
| `findImplementations` | classes implementing an interface                                                                    |
| `callHierarchy`       | callers (incoming) or callees (outgoing) of a symbol, walked to a bounded depth                      |
| `outlineFile`         | structural "table of contents": declarations (incl. nested in namespaces) + re-exports               |
| `outlineSymbol`       | members of a class / interface / namespace                                                           |
| `outlineFunction`     | statement-level skeleton of a function body (incl. arrow/function-expression consts)                 |
| `listImports`         | the import statements of a file (module + named/default/namespace) — module wiring                   |
| `publicSurface`       | transitive public surface of an entry barrel — expands `export *` to concrete symbols                |

All operations are **deterministic** AST queries — kestrel never runs an LLM. Prose summaries
are the calling agent's job; kestrel hands it exact structure.

Modification (rename / move) is deferred. Multi-language is out of scope (TypeScript only).
See [docs/VISION.md](docs/VISION.md) for the full scope and [docs/DESIGN.md](docs/DESIGN.md)
for architecture.

## Architecture

```
packages/
  core/   warm ts-morph Project, symbol resolution, query + outline ops (transport-agnostic)
  mcp/    MCP server adapter (keeps core warm across tool calls)
  cli/    CLI adapter
```

The analysis engine is swappable behind the core API. The current engine is ts-morph; the
vision engine is Microsoft's Go-native [`tsgo`](https://github.com/microsoft/typescript-go)
once it ships an embeddable find-references API.

## Usage

**CLI** — one-shot semantic queries (JSON output; `outline-file` prints a compact tree):

```bash
kestrel resolve src/foo.ts:Bar --tsconfig tsconfig.json
kestrel refs src/foo.ts:Bar --tsconfig tsconfig.json --exclude-tests
kestrel outline-file src/foo.ts --tsconfig tsconfig.json
```

**MCP** — the same operations as MCP tools over stdio, holding the ts-morph project warm
across calls (no per-call cold start). Point an MCP host at the server binary:

```json
{ "mcpServers": { "kestrel": { "command": "kestrel-mcp" } } }
```

Tools: `resolve`, `search`, `definition`, `usages`, `calls`, `implementations`,
`outline_file`, `outline_symbol`, `outline_function`, `imports`, `surface`, `usage_report`.
Each takes a `tsConfig` argument; the engine is cached per tsconfig.

## Development

Requires Node.js 24+ and pnpm. The repo uses [nadle](https://nadle.dev) as its task runner.

```bash
pnpm install
pnpm build          # nadle build (tsc project references)
pnpm test           # nadle test (vitest)
pnpm exec nadle check    # eslint + prettier
```

## License

MIT
