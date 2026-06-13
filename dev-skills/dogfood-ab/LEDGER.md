# dogfood-ab ledger

One row per round. Tracks grep-fallback count (symantic arm) round-over-round under the **fixed
question** so convergence to grep parity is visible. Rounds before the fixed-question series
used ad-hoc questions and a strict symantic-only arm (no fallback metric) — recorded for
history, not comparable on fallback count.

Target repos are private and anonymized here (engine A / B / C — A12 `*-engine` packages, same
client-core/Redux/saga shape). The grep baseline is run once per repo (the first round on it);
later rounds run the symantic arm only, tracking its fallback count converge.

## Fixed-question series (symantic-preferred arm; fallback count comparable)

| Round | Repo     | Date       | Fixed-Q | Fallbacks (raw / verified-gap) | Issues                       |
| ----- | -------- | ---------- | ------- | ------------------------------ | ---------------------------- |
| 4     | engine A | 2026-06-09 | v1      | 6 / **0**                      | none                         |
| 5     | engine A | 2026-06-10 | v1      | 1 / **1**                      | fixed in-loop                |
| 6     | engine A | 2026-06-10 | v1      | 2 / **2**                      | 1 fixed, 1 deferred          |
| 7     | engine A | 2026-06-10 | v1      | 0 / **0**                      | none (converged)             |
| 8     | engine A | 2026-06-10 | v1      | 0 / **0**                      | proactive: --kind            |
| 9     | engine B | 2026-06-10 | v1      | 3 / **2**                      | 1 fixed, 1 deferred          |
| 10    | engine B | 2026-06-10 | v1      | 1 / **0**                      | none (--path used)           |
| 11    | engine B | 2026-06-10 | v1      | 0 / **0**                      | none (converged)             |
| 12    | engine A | 2026-06-10 | v1      | 0 / **0**                      | perf round: 3 drafts pending |
| 13    | engine A | 2026-06-13 | v1      | 0 / **1**                      | #116 (lsp ENOENT parity)     |
| 14    | engine B | 2026-06-13 | v1      | 0 / **0**                      | none (converged)             |
| 15    | engine A | 2026-06-13 | v1      | 0 / **1**                      | #95 reopened (objlit parity) |
| 16    | engine B | 2026-06-13 | v1      | 0 / **0**                      | none (converged)             |

Round 12 notes (symantic arm only, perf-instrumented — every command timed): **zero
grep/Read fallbacks on TS source**; convergence holds on engine A. The round's yield is
all perf/output-quality, surfaced by timing instrumentation, each verified on own
fixtures/source: (1) `view file --body` broken both engines differently — ts-morph
silently ignores `--body` (outline only), lsp duplicates namespace members recursively
(deep member printed 3×); repro'd on `nested.ts`/`consumer.ts`. (2) `find symbol`
cold-start: ~3s per call on a mid-size package (both engines), 8.6–13.5s via lsp from a
large workspace root — no CLI daemon/index cache (MCP keeps a warm engine; CLI pays full
project load per invocation). (3) shared-base root tsconfig footgun: ts-morph loads a
0-file project and prints a misleading `(none)` + `--contains` hint; lsp instead searches
the whole workspace incl. `lib/**/*.d.ts` build outputs (returns d.ts twins of source
hits) — divergence with no 0-file warning. Operator notes (not gaps): the arm's `view
body` complaint was stale — `--source` + the short-body hint (#93 fix) already exist and
were shown; and most of the 8–13s latency was self-inflicted by running from the repo
root instead of the per-package tsconfig (10.6s → 3.3s, lib noise gone). Side
observation, not filed: `view symbol`/`view body` not-found prints raw
`{"kind":"not-found"}` JSON with no hint — adjacent to open #94/#101.

Rounds 13–16 notes (OE = engine A, TE = engine B; fixed question + two variant
slices to exercise different layers — row-select/multi-delete on A, drag-drop
node-move on B). **Zero grep/Read fallbacks across all four symantic arms** — every
"fallback" the agents logged was operator error (bare name where `::` was needed,
wrong `#index` on a non-overloaded member, `:L270-330` region syntax) or
grep-over-symantic-*output*, not a source-navigation fallback. Convergence holds.
Yield is two **partial-regression** gaps, both reproduced on own fixtures:
(1) **#116** (new) — lsp file-read ops raw-throw Node `ENOENT` on a missing file,
leaking the root-joined absolute path, where ts-morph gives the honest
`file not found in project (…path correct?)` message. Root cause: lsp `#read` →
`readFileSync` with no existence check; `resolveProjectFile` returns a root-joined
guess on miss. (2) **#95 reopened** — object-literal members were fixed on the
**lsp** engine only (`find symbol greet --contains` + `view symbol const::member`
now resolve there) but the default **ts-morph** engine is still blind, and
`view members <objlit-const>` is `(no members)` on **both** — two ops disagreeing
(members says none; `::` resolves one). Dropped lead: `find callers` vs `find refs`
on an action-creator (#96) does **not** reproduce — round-15's `(none)` was a bare
name (`actions.ts:onRowsSelected`) vs the needed `Events::onRowsSelected`; the
namespace-nested-creator shape resolves correctly (verified on a scratch fixture).

Round 11 notes (symantic arm only): **zero fallbacks, zero gaps**. Used `--path`,
`--exclude-tests`, `--kind`, and `view members` all natively — no shell-pipe, no
Read on TS source. Found both halves of the flow. Two lsp friction notes (not
fallbacks): `view symbol` with a `#index` overload address and a `::`-nested
arrow/const member each returned not-found under `--engine lsp`; neither blocked
the answer. Same body-local/addressing family as the round-6 and round-9
deferrals — the recurring theme worth a dedicated fixture + fix later.

Round 10 notes (symantic arm only — the grep baseline is set once per repo in
round 9; re-running it each round just reproduces the same answer at token
cost). The round-9 `--path` fix landed: the arm used `--path view` to scope a
cast cleanly instead of `| grep view/`. Down to **1 fallback, 0 gaps** — and
that one was operator habit (grepped a printed outline for namespace members
where `view members <file>:Ns` was the native op; verified `view members`
works fine on a namespace). Cost note observed this round: the symantic arm
runs **more tool calls + more wall-time** than grep (fine-grained per-symbol
ops, + lsp cold-index ~3s) but **fewer tokens** (53k vs 64k) — it trades
process-time for context economy, the right trade for an agent.

Round 9 notes (first run on engine B — tests whether the engine-A fixes
generalize): they do. The symantic arm found **both halves** of the flow with
**no Read-tool fallback**, at ~53k tokens vs the grep arm's ~95k (~17 files,
~2800 lines). Used `--exclude-tests`/`--kind` cleanly. Three fallbacks, all
shell-pipes of symantic output (no raw grep-for-code): two were
`| grep <dir>` to scope hits to a subtree — **verified gap, fixed in-loop:**
added `path` to `SearchOptions` + `--path <substr>` CLI flag, both engines,
repro'd on fixtures (`area` `--path consumer` → only consumer.ts). The third
fallback was friction, not a fix: **`::` addressing into function-local
declarations** (a generator assigned to an object property, a const inside a
factory's returned object) returned not-found — but a statement-level inner
function (`makeSelectors::mean`) resolves fine on both engines, so the failing
shape is property-value/closure-local, not all body-locals. **Deferred** —
needs a synthetic fixture matching the exact failing shape (can't repro from
private code). Same neighbourhood as the round-6 import-alias deferral
(body-local resolution).

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
`find symbol` to cut collision noise (a `action` fragment matched UI
component names). Now that kind classification works (round 5), a `--kind`
filter is cheap + high-value → round 8 target.

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
symbols the agent grepped for — including the saga layer the symantic arm
wrongly concluded didn't exist. Residual friction is a **skill/guidance gap**
(orient by casting `find symbol --contains` wide before grepping; nested decls
are `::`-addressable), not a symantic code gap — no issue filed. Convergence
holding: real code gaps from earlier rounds (#102-#105) are fixed; round 4
found none.

## Pre-series history (strict symantic-only arm; ad-hoc questions)

| Round | Repo     | Question                  | Verified gaps → issues                             |
| ----- | -------- | ------------------------- | -------------------------------------------------- |
| 1     | engine B | node expand/collapse flow | #102, #103 (lsp namespace + function-scope parity) |
| 2     | engine A | column sorting flow       | #104 (lsp interface-member dump)                   |
| 3     | engine C | add-link flow             | #105 (JSDoc release tags not surfaced)             |
