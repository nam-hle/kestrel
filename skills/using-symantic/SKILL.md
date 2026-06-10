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

| Question                                                  | Command                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Shape of this file?                                       | `symantic view outline <file>`                                                  |
| Source of one declaration?                                | `symantic view symbol <file>:Name` (`::` nests, e.g. `Class::method`)           |
| Members of a class / interface / namespace?               | `symantic view members <file>:Name`                                             |
| Signature + callees + referenced types?                   | `symantic view context <file>:Name`                                             |
| Where defined / used / implemented?                       | `symantic find def\|refs\|impls <file>:Name`                                    |
| Who calls it / what does it call?                         | `symantic find callers\|callees <file>:Name`                                    |
| Find a symbol, file unknown — exact name?                 | `symantic find symbol Name`                                                     |
| Find a symbol, file unknown — only know part of the name? | `symantic find symbol Foo --contains` (substring; your orientation entry point) |
| A file's imports / public surface?                        | `symantic imports <file>` · `symantic exports <file>`                           |

Rest, briefly: `view file` (whole file, lean; `--body` for each export's source), `view body`
(statement skeleton of a function), `view region <file>:Lstart-Lend`, `usage` (per-export
reference counts), `resolve` (qualified name → symbol or candidates). Flags: `symantic <cmd> --help`.

## Addressing

- `file:Name` — file is project-relative, forward-slashed.
- `::` separates nesting segments (namespace / class / interface / module).
- `#index` disambiguates same-name collisions (overloads, declaration merging), e.g. `f#1`.
- **Outputs are re-feedable**: a symbol address in one result is valid input to the next op.
- **Nested declarations are addressable too** — don't Read a line range to see one method,
  property, or nested type. `view symbol <file>:Owner::member` (or `view members <file>:Owner`)
  returns just that member. A line-range `view region` / Read is a habit fallback here, not a
  necessity.

Example chain:

```
symantic view outline src/server.ts        # see the shape
symantic view context src/server.ts:start  # signature + callees + types of one decl
symantic find callers src/server.ts:start  # who calls it
```

## Engine

Append `--engine lsp` (tsgo-backed, faster on the hot path) to any command by default. Drop it
— back to the default ts-morph engine — if it errors that tsgo is unavailable, returns
empty/surprising results, or shows a parity gap. Known gap: `find symbol` on `--engine lsp` can
return empty where the default engine finds the symbol — if a name search comes back `(none)`,
retry without `--engine lsp` before concluding the symbol doesn't exist.

## grep + symantic — division of labor

symantic is **not** a grep replacement; the two compose. symantic addresses code by _name_,
not by path or text — it has no file/directory enumeration. Use grep/find to **orient**, then
symantic to **understand**:

- **grep / find / ls** → when you have no symbol name yet: locate files or dirs by path, search
  raw text, string literals, config, or any non-TS file.
- **symantic** → the moment you have a name or a file: outline, symbol / members / context
  source, def / refs / impls, callers / callees, imports / exports.

Common trap: reaching for a shell `find -iname '*foo*'` to locate a feature. Try
`symantic find symbol Foo --contains` first — it searches symbol names across the project and
hands back addresses you can drill straight into. Fall to shell `find` only when you're after a
_file path / non-TS file_, not a symbol.

**Orienting by _concept_, not a known name?** (e.g. "where is data loading triggered?", "is
there a saga layer?") Don't grep the source — cast `find symbol --contains` with a broad
fragment of the concept (`load`, `saga`, `dispatch`, `reducer`) **first**. It surfaces every
matching symbol across the whole project, including layers in directories you haven't opened —
the exact case where grep makes you miss code that lives where you didn't look. Only grep the
concept when a sensible fragment genuinely yields nothing.

**Tracing a whole flow? Cast for _every_ layer's vocabulary, not just the first hit.** An
end-to-end flow (UI → action → reducer/saga → server → render) spans several layers, each with
its own naming. Casting `find symbol reducer/saga --contains` finds the client-state half but
**stops there** — the server-data half lives under different words (`provider`, `loader`,
`query`, `request`, `executePlan`, `fetch`). Enumerate the layers you expect _up front_ and
cast a fragment for each; a flow that "delegates to the framework" often still has a local
provider/loader doing the real work. The kind column (`cls`/`fn`/`iface`) on each `--contains`
hit is your cheapest orientation signal — a `…Provider`/`…Loader` _class_ among `fn` hits is
often the server seam.

When a `--contains` cast drowns in test-file hits (`*.test.ts`, `__tests__/`, `e2e/`) on a
project whose tsconfig includes tests, add **`--exclude-tests`** to drop them — don't pipe the
output through `grep -v test`. When a fragment collides with unrelated symbols (e.g. `action`
matching `ActionBar`/`RowAction` components), narrow by declaration kind with
**`--kind cls,iface,fn,ns,const,type,enum`** instead of eyeballing a long list.

## When to fall back to Read/grep

Only when symantic can't serve it: non-TS file, file outside the tsconfig project, no
`tsconfig.json` findable, symantic not installed, or no op fits a quick one-off. Don't force it.
