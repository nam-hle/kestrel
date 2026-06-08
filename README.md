<div align="center">

# symantic

**Semantic code navigation for TypeScript, built for an agent's token budget and address model.**

[![CI](https://github.com/nam-hle/symantic/actions/workflows/ci.yml/badge.svg)](https://github.com/nam-hle/symantic/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@symantic/cli?label=%40symantic%2Fcli)](https://www.npmjs.com/package/@symantic/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-43853d.svg)](https://nodejs.org)

[Quick start](#quick-start) · [Why symantic](#why-symantic) · [Operations](#what-it-does-v1-read-only) · [Agent skill](#agent-skill-claude-code-plugin) · [MCP](#mcp-server)

</div>

---

An AI agent has **no cursor** and a **finite context window**. Open a 2,000-line file to find one
method and you've spent thousands of tokens to read code you didn't need — and the answer comes
back as a byte offset the agent can't use.

symantic answers the questions an agent actually asks — _where is `X` used? what implements it?
what's the shape of this file?_ — with results that are:

- **Name-addressed** — `src/foo.ts:Bar::method`, never a byte offset. Every result feeds straight
  back into the next query.
- **Token-lean** — a compact tree, classified references, paginated. No LSP noise.
- **Compiler-accurate** — TypeScript via [ts-morph](https://ts-morph.com/) underneath. Accuracy is
  table stakes; the **output contract is the point**.

It is **deterministic** — symantic never runs an LLM. It hands the agent exact structure; the prose
is the agent's job.

> **Status:** early development. Read-only core engine + CLI + MCP server all working.

## Quick start

```bash
# one-shot query, no install
npx @symantic/cli view outline src/foo.ts

# or install the CLI globally → the binary is `symantic`
npm i -g @symantic/cli
symantic find refs src/foo.ts:Bar --exclude-tests
```

The nearest `tsconfig.json` is auto-discovered from the cwd; pass `--tsconfig <path>` to override.
Output is token-lean, address-first text by default — add `--json` for the structured form.

## Why symantic

Several tools already bridge a language server to MCP. They give compiler-accurate references — but
they pipe **raw LSP** through: byte-offset positions (an agent has no cursor to resolve them) and
verbose payloads (burning the context window). They answer the question, then make the agent pay to
parse and re-address the answer.

symantic is the layer those bridges skip:

|                     | Raw LSP→MCP bridge                | symantic                                          |
| ------------------- | --------------------------------- | ------------------------------------------------- |
| **Addressing**      | byte offsets (no cursor to apply) | qualified names you feed into the next query      |
| **Output**          | verbose LSP payloads              | compact trees, classified + paginated refs        |
| **Synthesized ops** | pass-through only                 | statement skeletons, public surface, usage report |

Ops with **no LSP equivalent** — `view body` (statement skeleton), `exports` (transitively expands
`export *`), bounded call hierarchy, `usage` (dead-code in one call). A bridge wrapping a language
server can't produce these by pass-through.

The engine (ts-morph today, [tsgo](https://github.com/microsoft/typescript-go) later) is
commoditized. The output contract is the durable part — see the
[v1 roadmap epic](https://github.com/nam-hle/symantic/issues/78).

## What it does (v1, read-only)

Commands group by intent: **`view`** (read code) and **`find`** (locate / trace), plus top-level
`resolve` / `imports` / `exports` / `usage`.

| Command                             | What you get                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `view outline <file>`               | structural table of contents: declarations (incl. nested) + re-exports          |
| `view symbol <file>:Name`           | the exact source of one declaration                                             |
| `view members <file>:Name`          | members of a class / interface / namespace                                      |
| `view context <file>:Name`          | source + signature + callees + referenced types                                 |
| `view body <file>:Name`             | statement-level skeleton of a function body                                     |
| `view region <file>:Lstart-Lend`    | an addressed line range                                                         |
| `find def <file>:Name`              | all declaration sites (handles declaration merging)                             |
| `find refs <file>:Name`             | usages, classified by kind (import / call / type-ref / read / write), paginated |
| `find impls <file>:Name`            | classes implementing an interface                                               |
| `find callers` / `callees`          | incoming / outgoing call hierarchy, bounded depth                               |
| `find symbol Name`                  | repo-wide search for a name (`--contains` for substring) → candidates           |
| `imports <file>` / `exports <file>` | a file's import statements / transitive public surface (expands `export *`)     |
| `resolve <file>:Name`               | resolve a qualified name → symbol or candidates                                 |
| `usage <file>`                      | per-export reference counts of an entry (dead-code in one call)                 |

See [docs/VISION.md](docs/VISION.md) for full scope, [docs/DESIGN.md](docs/DESIGN.md) for
architecture, [docs/ADDRESSING.md](docs/ADDRESSING.md) for the `file:Name::nested#index` scheme.
Modification (rename / move) is deferred. Multi-language is out of scope — TypeScript only.

### symantic + grep

symantic addresses code by _name_, not by path or raw text — it has no file enumeration. It
**composes** with grep rather than replacing it. Use `grep`/`find` to **orient** (locate files,
search text/config/non-TS); use symantic to **understand** (everything structural, once you have a
name or file). When you only know part of a name, reach for `find symbol <part> --contains` before
shelling out to `find` — it searches symbol names project-wide and returns addresses you can drill
straight into.

## Agent skill (Claude Code plugin)

This repo ships a Claude Code skill, **`using-symantic`**, that teaches an agent to reach for
symantic instead of reading whole files or grepping — a question-to-op decision tree plus the
addressing crib. Install it as a plugin:

```
/plugin marketplace add nam-hle/symantic
/plugin install symantic@symantic
```

The skill then loads as `symantic:using-symantic` and triggers whenever the agent is about to read
or trace TypeScript. The plugin is fetched by git (a clone of this repo) — separate from npm.

> The skill **teaches** the agent to use symantic; it doesn't bundle the binary. For the commands
> it recommends to run, install the CLI too: `npm i -g @symantic/cli` (or rely on `npx`).

## MCP server

The same operations as MCP tools over stdio, holding the project warm across calls (no per-call
cold start). Runs via `npx @symantic/mcp`.

<details>
<summary><b>Host setup</b> (Claude Code · Cursor · Codex)</summary>

_Claude Code_ — `.claude/mcp.json` (or `claude mcp add`):

```json
{ "mcpServers": { "symantic": { "command": "npx", "args": ["-y", "@symantic/mcp"] } } }
```

_Cursor_ — `~/.cursor/mcp.json` (or `.cursor/mcp.json` in the project):

```json
{ "mcpServers": { "symantic": { "command": "npx", "args": ["-y", "@symantic/mcp"] } } }
```

_Codex_ — `~/.codex/config.toml`:

```toml
[mcp_servers.symantic]
command = "npx"
args = ["-y", "@symantic/mcp"]
```

</details>

Tools: `view_outline`, `view_symbol`, `view_context`, `view_region`, `view_members`, `view_body`,
`find_symbol`, `find_def`, `find_refs`, `find_impls`, `find_callers`, `find_callees`, `resolve`,
`imports`, `exports`, `usage_report`. Each takes a `tsConfig` argument (engine cached per tsconfig);
pass `engine: "lsp"` for the tsgo backend, or `json: true` for structured output.

## The `lsp` engine (experimental)

Add `--engine lsp` to any CLI command to use the tsgo-backed engine instead of the ts-morph default.

> It needs `@typescript/native-preview` (tsgo), declared as an _optional_ dependency — the default
> ts-morph engine pulls no native binary. tsgo ships per-platform preview builds; if it's absent or
> unavailable for your platform (e.g. Alpine/musl), `--engine lsp` errors with an install hint while
> the default engine keeps working.

## Token savings (`gain`)

Every CLI query records an estimated token saving — symantic's structured output vs. the cost of
reading the raw files the result referenced — to a local ledger at `~/.symantic/gain.jsonl`.

```bash
symantic gain                # summary: queries, symantic vs baseline tokens, % saved, top ops
symantic gain --history      # recent queries, one per line
symantic gain --by-project   # totals grouped by project directory
symantic gain --json         # machine-readable aggregate
```

Figures are `~`-estimates (`ceil(bytes / 4)`, no tokenizer); the baseline counts only the files each
result referenced, never the whole project.

**Privacy:** tracking is always on and writes project paths + op names to `~/.symantic/gain.jsonl`.
The ledger is **local only** — nothing is transmitted. Delete it any time to reset.

## Packages

| Package                           | Role                                                               |
| --------------------------------- | ------------------------------------------------------------------ |
| [`@symantic/core`](packages/core) | warm ts-morph Project, symbol resolution, query + outline ops      |
| [`@symantic/cli`](packages/cli)   | the `symantic` CLI — one-shot semantic queries                     |
| [`@symantic/mcp`](packages/mcp)   | MCP server — the same ops as tools, project held warm across calls |

The analysis engine is swappable behind the core API.

## Development

Requires Node.js 24+ and pnpm. Task runner: [nadle](https://nadle.dev).

```bash
pnpm install
pnpm build               # nadle build (tsc project references + bundle)
pnpm test                # nadle test (vitest)
pnpm exec nadle check    # eslint + prettier
```

## License

MIT
