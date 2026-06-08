# symantic — project guide for Claude

Semantic symbol intelligence for TypeScript, shaped for AI agents. Read-only v1: query +
outline, deterministic, no LLM inside symantic. See `docs/VISION.md` and `docs/DESIGN.md` for
scope and architecture.

## Layout

```
packages/
  core/   warm ts-morph Project, symbol resolution, query + outline ops (transport-agnostic)
  mcp/    MCP server adapter
  cli/    CLI adapter (citty subcommands, JSON output)
skills/   the using-symantic Claude Code skill (shipped as a plugin via .claude-plugin/)
docs/     project docs (see below)
```

Tests live in `packages/core/src/__tests__/`. Fixtures under `__tests__/fixtures/`.

### Docs (`docs/`)

- `VISION.md` — what we're building and why; scope, the shipped op set, engine roadmap.
- `DESIGN.md` — architecture (core ↔ adapters, the engine interface).
- `PRINCIPLES.md` — the values that drive the roadmap and adjudicate tradeoffs; consult it
  when a change forces a fast-vs-correct-vs-token-lean call.
- `ADDRESSING.md` — the `file:Name::nested#index` qualified-name scheme.

`docs/superpowers/` (plans/specs) are local dev artifacts — gitignored, never committed.

## Tooling

- Node 24+, pnpm, ESM throughout. `@types/node` pinned to v24 to match the runtime.
- Task runner: **nadle** (`nadle.config.ts`) — the only runner; packages carry no scripts.
  Engine: **ts-morph**. Bundler for the cli/mcp bins: **tsup** (one root `tsup.config.ts`).
- Single root config per concern: `tsconfig.check.json` (whole-repo `noEmit`, used by both
  ESLint and `typecheck`), `vitest.config.ts`, `eslint.config.ts`, `tsup.config.ts`. tsconfig
  inheritance: `base` (noEmit) → `src` (composite emit, excludes tests) → per-package.
- Lint/format configs are shared `@nadle/*` packages. Prettier uses **tabs**, printWidth 150.
- Run the CLI locally via `./packages/cli/dist/index.js` (pnpm does not link workspace bins),
  or link it globally as `symantic` — see **Dogfooding** below.

### Dogfooding the CLI

We develop symantic by using it on its own source — the fastest way to surface real
ergonomics/correctness gaps. Keep a global `symantic` linked and reach for it whenever you'd
otherwise grep for a symbol.

**Prefer `symantic` over the Read tool for TypeScript source** (`view outline|symbol|body|
region|context|members`, `find refs|def|impls|callers|callees`, `imports`/`exports`). Read on
`.ts` is the textual habit symantic replaces. Fall back to Read only when symantic can't serve it
— non-TS files, out-of-project files, or a missing op. Falling back on TS source = a gap: note
what you needed + why no op fit, and file it as a feature/ergonomics issue.

- **Link** (once, on the active Node 24 toolchain — `npm link` binds the bin to the _current_
  Node version's bin dir, so relink after any `nvm use`):
  `cd packages/cli && npm link` → `symantic` on PATH.
- **Rebuild before use** when core/cli changed: `pnpm build` (the link points at `dist/`).
- **tsconfig:** pass the per-package config, e.g. `--tsconfig packages/core/tsconfig.json`.
  The root `tsconfig.src.json` is a composite _base_ (`${configDir}/src` → repo root), not a
  loadable project. Paths are interpreted relative to **cwd**.
- **When symantic hits a bug or friction mid-task, file it** (don't just work around it): a
  GitHub issue with `type:`/`severity:`/`scope:` labels, repro, root cause if known. Attach to
  the `v1` milestone when it gates v1. This loop is the point of dogfooding — issues
  #79–#82 came from one session. Verify the bug (read the code / re-run) before filing.

### Scripts (all via `pnpm exec nadle <task>`; `build`/`test` also as `pnpm <task>`)

- `build` — `emit` (`tsc -b`, type-checks + emits every src) + `typecheck`
  (`tsc -p tsconfig.check.json --noEmit`, the only pass covering tests) + `bundle` (tsup).
- `test` (vitest) · `check` (eslint + prettier) · `format` (fix) · `clean`.
- Run vitest with `--reporter=agent` for token-lean, agent-readable output, e.g.
  `pnpm exec vitest run --reporter=agent`.
- Run `format` to fix prettier/eslint issues before commiting.
- nadle runs several tasks in one invocation and orders them by dependency, so chain the
  whole pre-commit gate in one call: `pnpm exec nadle build format check` (emit + typecheck,
  fix formatting, then verify lint/format), or add `test`: `pnpm exec nadle build format check test`.
  Shorter combos work too — `pnpm exec nadle format check` (fix then verify),
  `pnpm exec nadle build test`.

## Conventions

- TDD: write the failing test first, watch it fail, then implement (red-green-refactor).
- Cross-platform: ts-morph paths are forward-slash; normalize before string ops (Windows CI).
- Verify before claiming done: run build + test + check; never assert green without output.

## Commit messages — Conventional Commits

- Subject: `type(scope): summary`. The `(scope)` is optional. Summary is imperative
  mood, lower-case, **no trailing period**, and the whole subject is ≤ ~50 chars.
  `feat(cli): add --version flag`, not `Added a version flag.`
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`.
- Scopes map to packages: `core`, `cli`, `mcp`. Omit the scope for repo-wide or
  cross-cutting changes.
- Breaking changes: append `!` after the type/scope (`feat(core)!: …`) and explain
  in the body.
- Blank line, then a body wrapping at ~72 chars explaining **what and why** (not how).
- Use bullet lists in the body for multiple distinct changes.
- One logical change per commit; keep them atomic.
- Reference issues at the end when applicable (`Fixes #123`).

## Git

- Never commit to `main` directly when the change warrants review; otherwise small fixes on
  `main` are fine for this solo repo. Run lint + tests before committing.
- `docs/superpowers/` (plans/specs) are local dev artifacts — gitignored, never in a PR.
  Fine to keep on disk while working; exclude them from any commit/PR.
- CI (`.github/workflows/ci.yml`) runs build / lint / test (cross-OS, Node 24) on push + PR.
