# kestrel — project guide for Claude

Semantic symbol intelligence for TypeScript, shaped for AI agents. Read-only v1: query +
outline, deterministic, no LLM inside kestrel. See `docs/VISION.md` and `docs/DESIGN.md` for
scope and architecture.

## Layout

```
packages/
  core/   warm ts-morph Project, symbol resolution, query + outline ops (transport-agnostic)
  mcp/    MCP server adapter (stub)
  cli/    CLI adapter (citty subcommands, JSON output)
```

Tests live in `packages/core/src/__tests__/`. Fixtures under `__tests__/fixtures/`.

## Tooling

- Node 24+, pnpm, ESM throughout. `@types/node` pinned to v24 to match the runtime.
- Task runner: **nadle** (`nadle.config.ts`) — the only runner; packages carry no scripts.
  Engine: **ts-morph**. Bundler for the cli/mcp bins: **tsup** (one root `tsup.config.ts`).
- Single root config per concern: `tsconfig.check.json` (whole-repo `noEmit`, used by both
  ESLint and `typecheck`), `vitest.config.ts`, `eslint.config.ts`, `tsup.config.ts`. tsconfig
  inheritance: `base` (noEmit) → `src` (composite emit, excludes tests) → per-package.
- Lint/format configs are shared `@nadle/*` packages. Prettier uses **tabs**, printWidth 150.
- Run the CLI locally via `./packages/cli/dist/index.js` (pnpm does not link workspace bins).

### Scripts (all via `pnpm exec nadle <task>`; `build`/`test` also as `pnpm <task>`)

- `build` — `emit` (`tsc -b`, type-checks + emits every src) + `typecheck`
  (`tsc -p tsconfig.check.json --noEmit`, the only pass covering tests) + `bundle` (tsup).
- `test` (vitest) · `check` (eslint + prettier) · `format` (fix) · `clean`.
- Run vitest with `--reporter=agent` for token-lean, agent-readable output, e.g.
  `pnpm exec vitest run --reporter=agent`.

## Conventions

- TDD: write the failing test first, watch it fail, then implement (red-green-refactor).
- Cross-platform: ts-morph paths are forward-slash; normalize before string ops (Windows CI).
- Verify before claiming done: run build + test + check; never assert green without output.

## Commit messages — Google style

- Subject: imperative mood, capitalized, **no trailing period**, ≤ ~50 chars.
  `Implement the CLI`, not `implemented cli.` or `Added CLI.`
- Blank line, then a body wrapping at ~72 chars explaining **what and why** (not how).
- Use bullet lists in the body for multiple distinct changes.
- One logical change per commit; keep them atomic.
- Reference issues at the end when applicable (`Fixes #123`).
- Co-author trailer on every commit:

  ```
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

  Use the running model id as the author name when known (e.g. `Claude Opus 4.8`).

## Git

- Never commit to `main` directly when the change warrants review; otherwise small fixes on
  `main` are fine for this solo repo. Run lint + tests before committing.
- CI (`.github/workflows/ci.yml`) runs build / lint / test (cross-OS, Node 24) on push + PR.
