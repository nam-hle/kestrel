# dogfood-ab ledger

One row per round. Tracks grep-fallback count (symantic arm) round-over-round under the **fixed
question** so convergence to grep parity is visible. Rounds before the fixed-question series
used ad-hoc questions and a strict symantic-only arm (no fallback metric) — recorded for
history, not comparable on fallback count.

## Fixed-question series (symantic-preferred arm; fallback count comparable)

| Round | Repo | Date | Fixed-Q | Fallbacks | Issues |
|---|---|---|---|---|---|
| _next_ | overview-engine | 2026-06-09 | v1 | _tbd_ | _tbd_ |

## Pre-series history (strict symantic-only arm; ad-hoc questions)

| Round | Repo | Question | Verified gaps → issues |
|---|---|---|---|
| 1 | tree-engine | node expand/collapse flow | #102, #103 (lsp namespace + function-scope parity) |
| 2 | overview-engine | column sorting flow | #104 (lsp interface-member dump) |
| 3 | relationship-engine | add-link flow | #105 (JSDoc release tags not surfaced) |
