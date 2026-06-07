# kestrel — Roadmap

Sequenced by leverage. The differentiator is **agent-shaped output** (name-addressing +
token-lean + synthesized ops), not the analysis engine — the engine is commoditized
(LSP→MCP bridges already do compiler-accurate refs/impls/rename; one runs on tsgo today).
Everything here protects or sharpens the ergonomics wedge.

## Phase 0 — Prove the wedge (blocks everything)

Goal: demonstrate, with numbers, that kestrel's output is cheaper + more precise than an
LSP→MCP bridge on identical queries.

- [x] MCP adapter end-to-end (12 tools over stdio, warm engine per tsconfig).
- [ ] Benchmark harness vs. `mizchi/lsmcp` (tsgo-backed, so the comparison isolates
      ergonomics from engine speed). See [BENCHMARK.md](./BENCHMARK.md).
- [ ] Run on a real mid-size repo; capture tokens-consumed + false-hit rate per query.

**Exit criterion:** a reproducible script outputting "X% fewer tokens, Y fewer false hits"
vs. the bridge, on a fixed query set.

## Phase 1 — Trivial install

Goal: stranger → answering queries in their project in under 2 minutes.

- [ ] `npx kestrel-mcp` runnable with no build step.
- [ ] Zero config beyond the tsconfig path.
- [ ] One-line setup snippets for Claude Code, Cursor, Codex.

**Exit criterion:** a new user, given only the README, is querying their own repo in <2 min.

## Phase 2 — Deepen non-copyable ops

Goal: invest where an LSP pass-through has no equivalent — the real IP. A bridge wrapping a
language server cannot synthesize these.

- [ ] Promote `get_symbol_context` (signature + body + resolved callees + referenced types)
      from vision-level to a headline op.
- [ ] Harden `outlineFunction`, `publicSurface`, bounded `callHierarchy`.
- [ ] `--context=none|snippet|block` output levels (promised in VISION, unbuilt).

**Exit criterion:** at least one op that demonstrably answers a real agent question no LSP
bridge can answer in one call.

## Phase 3 — Become the reference

Goal: under the real threat (absorption by an IDE/model vendor), the win is being the design
that gets absorbed, not market share.

- [ ] Publish the addressing scheme + output format as a small spec.
- [ ] Publish the "agents need name-addressing, not byte-offsets" argument as a standalone
      post.
- [ ] Aim for citations / conformance over installs.

**Exit criterion:** someone else's tool adopts the addressing/output contract.

## Deliberately deferred

- **tsgo engine** — escape hatch for cold-start, not a differentiator (a competitor is already
  on tsgo; migrating wins nothing on its own). The viable route is **Door 3**: tsgo as an LSP
  subprocess, translated to kestrel's output contract. The opt-in `LspEngine` is now **built**
  (additive; ts-morph stays default) — see [TSGO-SPIKE.md](./TSGO-SPIKE.md) for the build notes
  and a real-repo A/B (≈2.9x cold load, ≈9.6x hot findUsages). Reference-set parity with the
  ts-morph engine is verified (identical positions, not just counts).
- **rename / move** — bridges do it adequately; reopens atomic-apply / rollback /
  stale-AST risk classes for little differentiation.
- **multi-language own engine** — never. Expose the output contract as language-agnostic
  with TS as the reference implementation instead of racing on breadth.

## The fatal risk

Absorption (Claude Code / Cursor / Copilot / a model vendor folding native code-nav in),
**not** the bridge competitors. Hedge = Phase 3: be the reference design.
