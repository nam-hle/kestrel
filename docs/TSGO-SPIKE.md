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
- **Door 3** — tsgo as an LSP server. Usable now (lsmcp uses it) but reintroduces byte
  offsets/verbose payloads internally; makes tsgo a backend, not a win. Rejected.

## Package reality (verify at spike time)

- `@typescript/native-preview` exists (e.g. `7.0.0-dev.*`). Explicitly WIP, API churns.
- `@typescript/api` does NOT exist on npm (404). The embeddable surface ships under
  `@typescript/native-preview` — confirm the exact import path + exported API in the
  installed version before writing any adapter code.

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

## Results

_(fill after running the spike)_
