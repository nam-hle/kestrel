# kestrel

> Semantic symbol intelligence for TypeScript, shaped for AI agents.

kestrel answers "where is symbol X used / what implements X / where is it defined" with
**compiler-accurate** semantics, returning token-lean, name-addressed results an AI agent can
act on. It borrows the TypeScript compiler (via [ts-morph](https://ts-morph.com/)) for the hard
part — type resolution — and builds the agent ergonomics on top.

**Status:** early development. The read-only core engine is implemented; the MCP and CLI
adapters are scaffolded.

## Why

AI coding agents answer "how is this symbol used" with `grep` — textual, not semantic.
Same-named symbols, overloads, shadowing, and type-only references all produce false hits or
misses. The semantic engine to do this correctly already exists; the gap is **agent-shaped
packaging**: existing tools use byte offsets (agents have no cursor) and emit verbose LSP
payloads (burning tokens). kestrel closes that gap.

## What it does (v1, read-only)

| Operation             | Description                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `searchSymbol`        | repo-wide search for a name across all files (exact, or `--contains` substring) → candidates         |
| `resolveSymbol`       | `relPath:name` (dotted for nested namespaces, `name#index` to pick) → symbol or candidates           |
| `findDefinition`      | all declaration sites (handles declaration merging)                                                  |
| `findUsages`          | references classified by kind (import / call / type-ref / read / write), bounded by `limit`/`cursor` |
| `findImplementations` | classes implementing an interface                                                                    |
| `outlineFile`         | structural "table of contents": exports, classes, interfaces, functions                              |
| `outlineSymbol`       | members of a class / interface                                                                       |
| `outlineFunction`     | deterministic statement-level skeleton of a function body                                            |

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
