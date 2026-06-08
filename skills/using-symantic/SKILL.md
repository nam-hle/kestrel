---
name: using-symantic
description: Use when navigating, reading, or tracing TypeScript/JavaScript source — understanding a file's shape, finding where a symbol is defined/used/implemented, tracing callers or callees, or about to Read a .ts/.tsx file or grep for a symbol in a project with a tsconfig. Redirects textual reads to semantic, name-addressed queries via the symantic CLI.
---

# Using symantic

`symantic` gives semantic, token-lean, name-addressed views of TS/JS code — far cheaper and
more precise than reading whole files or grepping for a name.

## The redirect (do this first)

Before you Read a `.ts`/`.tsx` file, or grep for a symbol in a project that has a
`tsconfig.json`: **stop and use symantic instead.** Read on TS source is the textual habit
symantic replaces.

Invocation shape — tsconfig is auto-discovered from cwd:

```
symantic <op> <file>:Name
```

Pass `--tsconfig <path>` only to override discovery. If symantic is wired into the session as
an **MCP server**, prefer its MCP tools over shelling out — same ops, same addressing.

## Which op — question → command

| Question | Command |
|---|---|
| Shape of this file? | `symantic view outline <file>` |
| Source of one declaration? | `symantic view symbol <file>:Name` (`::` nests, e.g. `Class::method`) |
| Members of a class / interface / namespace? | `symantic view members <file>:Name` |
| Signature + callees + referenced types? | `symantic view context <file>:Name` |
| Where defined / used / implemented? | `symantic find def\|refs\|impls <file>:Name` |
| Who calls it / what does it call? | `symantic find callers\|callees <file>:Name` |
| Find a symbol by name (file unknown)? | `symantic find symbol Name` |
| A file's imports / public surface? | `symantic imports <file>` · `symantic exports <file>` |

Rest, briefly: `view file` (whole file, lean; `--body` for each export's source), `view body`
(statement skeleton of a function), `view region <file>:Lstart-Lend`, `usage` (per-export
reference counts), `resolve` (qualified name → symbol or candidates). Flags: `symantic <cmd> --help`.

## Addressing

- `file:Name` — file is project-relative, forward-slashed.
- `::` separates nesting segments (namespace / class / interface / module).
- `#index` disambiguates same-name collisions (overloads, declaration merging), e.g. `f#1`.
- **Outputs are re-feedable**: a symbol address in one result is valid input to the next op.

Example chain:

```
symantic view outline src/server.ts        # see the shape
symantic view context src/server.ts:start  # signature + callees + types of one decl
symantic find callers src/server.ts:start  # who calls it
```

## Engine

Append `--engine lsp` (tsgo-backed, faster on the hot path) to any command by default. Drop it
— back to the default ts-morph engine — if it errors that tsgo is unavailable, returns
empty/surprising results, or shows a parity gap.

## When to fall back to Read/grep

Only when symantic can't serve it: non-TS file, file outside the tsconfig project, no
`tsconfig.json` findable, symantic not installed, or no op fits a quick one-off. Don't force it.
