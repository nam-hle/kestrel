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

**CLI** — one-shot semantic queries (JSON output; `view outline` prints a compact tree).
Commands group by intent: `view` (read code) and `find` (locate/trace), plus top-level
`resolve` / `imports` / `exports` / `usage`:

```bash
# read code
npx @kestrel/cli view outline src/foo.ts --tsconfig tsconfig.json
npx @kestrel/cli view symbol src/foo.ts:Bar --tsconfig tsconfig.json     # exact source
npx @kestrel/cli view context src/foo.ts:Bar --tsconfig tsconfig.json    # source + callees + types
npx @kestrel/cli view region src/foo.ts:10-40 --tsconfig tsconfig.json   # line range

# locate / trace
npx @kestrel/cli find refs src/foo.ts:Bar --tsconfig tsconfig.json --exclude-tests
npx @kestrel/cli find callers src/foo.ts:Bar --tsconfig tsconfig.json
npx @kestrel/cli find callees src/foo.ts:Bar --tsconfig tsconfig.json
```

(After a global install — `npm i -g @kestrel/cli` — the binary is just `kestrel`.) Add
`--engine lsp` to any command to use the tsgo-backed engine instead of the ts-morph default.

**MCP** — the same operations as MCP tools over stdio, holding the project warm across calls
(no per-call cold start). The server runs via `npx @kestrel/mcp`. Host setup:

_Claude Code_ — `.claude/mcp.json` (or via `claude mcp add`):

```json
{ "mcpServers": { "kestrel": { "command": "npx", "args": ["-y", "@kestrel/mcp"] } } }
```

_Cursor_ — `~/.cursor/mcp.json` (or `.cursor/mcp.json` in the project):

```json
{ "mcpServers": { "kestrel": { "command": "npx", "args": ["-y", "@kestrel/mcp"] } } }
```

_Codex_ — `~/.codex/config.toml`:

```toml
[mcp_servers.kestrel]
command = "npx"
args = ["-y", "@kestrel/mcp"]
```

Tools: `view_outline`, `view_symbol`, `view_context`, `view_region`, `view_members`,
`view_body`, `find_symbol`, `find_def`, `find_refs`, `find_impls`, `find_callers`,
`find_callees`, `resolve`, `imports`, `exports`, `usage_report`. Each takes a `tsConfig`
argument (engine cached per tsconfig); pass `engine: "lsp"` to opt into the tsgo backend.

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
