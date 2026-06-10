# dogfood-ab ledger

One row per round. Tracks grep-fallback count (symantic arm) round-over-round under the **fixed
question** so convergence to grep parity is visible. Rounds before the fixed-question series
used ad-hoc questions and a strict symantic-only arm (no fallback metric) — recorded for
history, not comparable on fallback count.

## Fixed-question series (symantic-preferred arm; fallback count comparable)

| Round | Repo            | Date       | Fixed-Q | Fallbacks (raw / verified-gap) | Issues              |
| ----- | --------------- | ---------- | ------- | ------------------------------ | ------------------- |
| 4     | overview-engine | 2026-06-09 | v1      | 6 / **0**                      | none                |
| 5     | overview-engine | 2026-06-10 | v1      | 1 / **1**                      | fixed in-loop       |
| 6     | overview-engine | 2026-06-10 | v1      | 2 / **2**                      | 1 fixed, 1 deferred |
| 7     | overview-engine | 2026-06-10 | v1      | 0 / **0**                      | none (converged)    |
| 8     | overview-engine | 2026-06-10 | v1      | 0 / **0**                      | proactive: --kind   |

Round 8 notes: no new A/B run — fallbacks already at 0. Acted on the round-7
friction note proactively: added a **`--kind` filter** to `find symbol`
(`kinds` on `SearchOptions`, both engines, `--kind cls,iface,fn,…` CLI flag),
reusing the round-5 kind classification + a now-exported `shortKind`. Repro'd
on fixtures (`Area` → `--kind cls` yields only the class, `iface,fn` the rest).
Skill updated to reach for `--kind` on collision noise. This widens symantic's
lead beyond parity: a kind-narrowed cast is a precision grep can't match
(text search has no notion of declaration kind).

Round 7 notes: **zero fallbacks** — convergence. The arm used `--exclude-tests`
on every `--contains` cast (no shell-piping), found both halves of the flow,
and was complete at fewer tokens than the grep arm. Trajectory 6→1→2→0. One
friction note (not a fallback): the arm wanted a `--kind` filter on
`find symbol` to cut collision noise (`action` matched UI `ActionBar`/
`RowAction`). Now that kind classification works (round 5), a `--kind` filter
is cheap + high-value → round 8 target.

Round 6 notes: re-ran after the round-5 fixes. The symantic arm now **found
both halves** of the flow (the round-5 miss is gone) — kind classification +
the multi-layer-orientation skill guidance worked, and it was more complete
than the grep arm on the server detail at fewer tokens. Two new fallbacks, both
verified gaps: (1) **shell-piped `grep -v test`** to filter test-file noise out
of `find symbol --contains` output — no production-only filter existed. **Fixed
in-loop:** added `excludeTests` to `SearchOptions` + `--exclude-tests` CLI flag,
both engines, repro'd on own source (`engine` fragment: 3 test hits → 0).
(2) **`view symbol` on an import alias** (`import { X as Y }`) failed on both
engines — `find symbol` lists the alias as a VariableDeclaration but neither
engine resolves it to its source. **Deferred** (needs a new fixture; narrower /
lower-frequency than the noise flood). Branch `feat/lsp-search-symbol-kind`.

Round 5 notes: fallback count dropped 6→1 (only a dir-tree listing, a legit
non-symantic need). But the symantic arm **missed the server-data half** of the
flow that the grep arm found — it oriented only by client-state vocabulary and
stopped at the framework hand-off, wrongly concluding no local server seam
existed. Two fixes shipped in-loop: (a) **code** — lsp `find symbol --contains`
emitted `kind: "unknown"` (dropped the LSP SymbolKind from workspace/symbol),
losing the orientation signal; now maps to the ts-morph kind string
(`lspSymbolKindToName`), parity restored, repro'd on symantic's own fixtures
(`Shape` → was `unknown`, now `InterfaceDeclaration`). (b) **skill** — teach
casting `--contains` for every layer's vocabulary when tracing a whole flow,
not just the first concept that hits. Branch `feat/lsp-search-symbol-kind`.

Round 4 notes: all 6 grep fallbacks were operator error / habit, not capability
gaps. `find symbol <fragment> --contains` (e.g. `load`, `Saga`) surfaces the
symbols the agent grepped for — including the `client-extensions/` saga layer the
symantic arm wrongly concluded didn't exist. #3/#5/#6 were `find refs` /
`view symbol` / `::`-addressing the agent skipped by habit. Residual friction is a
**skill/guidance gap** (orient by casting `find symbol --contains` wide before
grepping; nested decls are `::`-addressable), not a symantic code gap — no issue
filed. Convergence holding: real code gaps from rounds 1-3 (#102-#105) are fixed;
round 4 found none.

## Pre-series history (strict symantic-only arm; ad-hoc questions)

| Round | Repo                | Question                  | Verified gaps → issues                             |
| ----- | ------------------- | ------------------------- | -------------------------------------------------- |
| 1     | tree-engine         | node expand/collapse flow | #102, #103 (lsp namespace + function-scope parity) |
| 2     | overview-engine     | column sorting flow       | #104 (lsp interface-member dump)                   |
| 3     | relationship-engine | add-link flow             | #105 (JSDoc release tags not surfaced)             |
