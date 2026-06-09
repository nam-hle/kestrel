# dogfood-ab ledger

One row per round. Tracks grep-fallback count (symantic arm) round-over-round under the **fixed
question** so convergence to grep parity is visible. Rounds before the fixed-question series
used ad-hoc questions and a strict symantic-only arm (no fallback metric) — recorded for
history, not comparable on fallback count.

## Fixed-question series (symantic-preferred arm; fallback count comparable)

| Round | Repo | Date | Fixed-Q | Fallbacks (raw / verified-gap) | Issues |
|---|---|---|---|---|---|
| 4 | overview-engine | 2026-06-09 | v1 | 6 / **0** | none |

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

| Round | Repo | Question | Verified gaps → issues |
|---|---|---|---|
| 1 | tree-engine | node expand/collapse flow | #102, #103 (lsp namespace + function-scope parity) |
| 2 | overview-engine | column sorting flow | #104 (lsp interface-member dump) |
| 3 | relationship-engine | add-link flow | #105 (JSDoc release tags not surfaced) |
