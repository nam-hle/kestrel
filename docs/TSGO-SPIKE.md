# kestrel — tsgo (Door 2) spike spec

Question: can kestrel swap its engine from ts-morph to tsgo's programmatic API **while
staying in Node** — getting tsgo's ~10x typecheck speed without a Go rewrite?

This is a **throwaway spike**, not a migration. Deferred per the [ROADMAP](./ROADMAP.md):
tsgo is an escape hatch for cold-start, not a differentiator. Run this only to keep the
option warm / when cold-start complaints arrive.

## Three doors (recap)

- **Door 1** — Go-native embeddable API (what VISION planned). NOT viable: no committed
  stable Go embedding API (discussion only). Stays deferred.
- **Door 2** — programmatic API from Node via `@typescript/native-preview`. The sleeper —
  this spike.
- **Door 3** — tsgo as an LSP server (subprocess). **CHOSEN.** Spiked + works (see Door-3
  Results). Byte offsets stay internal, translated to kestrel's contract at the boundary —
  tsgo-as-backend is correct (engine is swappable; the differentiator is the output layer).
  This is how every tsgo-based tool (e.g. lsmcp) actually gets refs/impls; the embeddable API
  cannot (Door 2 Results). Earlier "rejected" note was wrong.

## Package reality (verify at spike time)

- `@typescript/native-preview` exists (e.g. `7.0.0-dev.*`). Explicitly WIP, API churns.
- `@typescript/api` does NOT exist on npm (404). The embeddable JS API ships under
  `@typescript/native-preview/unstable/{sync,async,fs,proto}`. Confirmed 2026-06-07: the
  surface is typechecker-level (Checker/Program/Symbol), with **no references/implementations**
  yet — see Results.

## What the spike must answer (pass/fail rubric)

1. **Surface exists** — does the programmatic API expose, callable from Node:
   - find-all-references for a symbol → list of locations,
   - find-implementations of an interface,
   - go-to-definition.
     PASS = all three reachable without spawning an LSP process. FAIL = must go through LSP
     (that's Door 3, rejected).

2. **Addressing in / out** — can a reference be requested by a stable identity (or at least a
   resolvable position) and results mapped back to kestrel's `file:Name` scheme without
   byte-offset bookkeeping leaking into the public API? PASS = kestrel's addressing model
   survives. FAIL = the API forces offset-centric round-tripping.

3. **Speedup is real** — on a mid-size repo, cold load + a batch of refs/impls queries:
   measure wall-time vs the current ts-morph engine. PASS = meaningfully faster (target ≥3x
   on cold load; the headline claim is ~10x typecheck). FAIL = parity or slower.

4. **Parity** — do refs/impls results match ts-morph's on the kestrel test fixtures +
   one real repo (same symbols found, no misses)? PASS = equal or better. FAIL = gaps.

5. **Stability** — does the same code run across two consecutive preview releases, or does
   the API break? Note churn risk explicitly.

## Method

- Throwaway branch `spike/tsgo-engine`. Do NOT touch `packages/core/src/engine.ts` on main.
- Add `@typescript/native-preview` as a spike-only dep.
- Write a tiny standalone script (not wired into the engine) that:
  1. loads a project via the programmatic API,
  2. runs find-references + find-implementations on 3-5 known symbols,
  3. prints results + timings,
  4. diffs results against `kestrel refs` / `kestrel impls` on the same symbols.
- Record findings in this file under a "Results" section. Delete the branch after.

## Decision gate

Adopt tsgo (Door 2) only if: rubric 1+2+4 PASS (surface + addressing + parity) AND (3 PASS
OR cold-start is an active user complaint). Otherwise keep ts-morph; revisit next preview.

## Results (2026-06-07)

Ran on `@typescript/native-preview@7.0.0-dev.20260606.1`.

**Package reality, corrected:** `@typescript/api` does NOT exist on npm (404). The programmatic
JS API ships inside `@typescript/native-preview` under `./unstable/sync`, `./unstable/async`,
`./unstable/fs`, `./unstable/proto` (package description: "Preview CLI and JS API for the
native TypeScript compiler port").

**Rubric #1 (surface exists): FAIL.** `unstable/sync` exports compiler/typechecker primitives —
`API, Project, Program, Checker, Symbol, Signature, Emitter`, plus flag enums. `Checker` exposes
`getSymbolAtLocation`, `getSymbolAtPosition`, `getTypeOfSymbol`, etc. But there is **no
find-references, no get-implementations, no language-service** in the programmatic surface.
Those ops live in the LSP layer (Door 3), not the embeddable API.

**Consequence:** to use Door 2, kestrel would have to reimplement find-references /
find-implementations on top of the raw checker (walk every file, resolve each identifier's
symbol, compare) — i.e. rebuild what ts-morph/tsserver give for free. That contradicts the
thesis ("borrow proven semantics, don't reinvent the typechecker"). Rubrics 2-5 not worth
running until #1 passes.

**Decision: keep ts-morph. Door 2 deferred.** Re-run this spike on a future preview; the gate
is the programmatic API exposing references + implementations without spawning an LSP process.
Branch + dep torn down (not merged).

## Door 3 — Results (2026-06-07): PASS, this is the path

Spiked `tsgo --lsp --stdio` end-to-end on the kestrel fixtures.

- **Transport works.** Spawn the `tsgo` bin (from `@typescript/native-preview`) with
  `--lsp --stdio`, speak LSP over stdio (Content-Length framing + JSON-RPC).
- **Capabilities advertised on initialize:** `referencesProvider`, `implementationProvider`,
  `definitionProvider`, `callHierarchyProvider`, `documentSymbolProvider`,
  `workspaceSymbolProvider`, `renameProvider`, and more — the full kestrel op set, plus rename
  for a future modify phase.
- **References verified live.** initialize → (answer the server's `workspace/configuration` +
  `client/registerCapability` requests — NOT answering them hangs the handshake) → initialized
  → `textDocument/didOpen` → `textDocument/references` at the symbol position → real locations
  matching the ts-morph engine's result (e.g. `makeCircle` → consumer.ts + e2e/usage.ts).
- **Output maps cleanly to kestrel's contract:** strip `file://<root>/` for the relative path;
  LSP 0-based line/char → kestrel 1-based. Byte offsets never leave the adapter.

**Architecture for the LspEngine** (next build session, see /tmp/kestrel-door3-handoff.md):
spawn one warm tsgo LSP per project root; bridge `file:Name` → a position (cheap: parse the
file / reuse a light AST pass to find the name's location) → LSP request → translate locations
back to kestrel types. Additive + opt-in; ts-morph stays default. The addressing bridge
(name → position) is the main design choice.

**Open caveats:** preview API/protocol churn; subprocess lifecycle + shutdown; warmth (one per
root); first query waits for project index (saw ~1.5s before references resolved on the tiny
fixture — measure on a real repo).
