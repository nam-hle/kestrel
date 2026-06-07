# kestrel `gain` command — design

Date: 2026-06-07
Status: design, pending implementation

## Problem

kestrel returns structured query output instead of raw file contents. The intended
value is token savings for an agent: a `find refs` or `view outline` call costs far
fewer tokens than reading the underlying files. Today that saving is invisible.

rtk has a `gain` command that reports cumulative token savings because it is a
long-lived proxy that sees raw-vs-trimmed output per command. kestrel is different:
each CLI invocation is stateless (the engine is created and disposed per call in
`withEngine`). To report cumulative gain, kestrel needs its own ledger and a defined
baseline.

## Decisions

- **Baseline** = tokens to read the raw files the query result references. The honest
  alternative to a kestrel query is opening those files with the Read tool.
- **Files counted** = the distinct files appearing in the query's result (every
  `position.file` plus any top-level `file`), deduped. Not the single subject file
  (understates cross-file ops), not the whole project (inflates, dishonest).
- **Token estimate** = `ceil(bytes / 4)`. Zero deps, deterministic. All reported
  figures are `~`-prefixed and documented as estimates. No real tokenizer (cosmetic
  accuracy gain not worth a dependency — see issue #69 on minimizing deps).
- **Ledger location** = `~/.kestrel/gain.jsonl`, global across projects (like rtk),
  each entry tagged with `cwd` so `gain` can group by project.
- **Tracking default** = ON, opt-out. Every query appends one ledger line. Opt out
  via `KESTREL_GAIN=0` (or `KESTREL_NO_GAIN=1`). Documented in `--help` and README
  with a privacy note (project paths and op names are written to the home dir).

## Scope

All work lives in `packages/cli`. No `@kestrel/core` changes — the gain logic reads
the result objects core already returns. No change to query output contracts: gain is
recorded to the ledger only, never appended to query JSON (keeps the agent-parsed
output pure).

## Components

All under `packages/cli/src/gain/`.

### `estimate.ts`
```
bytesToTokens(bytes: number): number   // ceil(bytes / 4)
```
Pure. The single place the heuristic lives.

### `files.ts`
```
filesIn(result: unknown): string[]
```
Walks the result JSON, collects every string under a `file` key (covers
`position.file` and top-level `file`), dedupes, returns sorted. Generic — works for
every op without per-op wiring.

### `ledger.ts`
```
interface GainEntry {
  ts: number;            // ms epoch, stamped by caller (Date.now lives in the CLI, not a pure fn)
  cwd: string;
  op: string;            // e.g. "find refs", "view outline"
  files: number;         // distinct result files
  kestrelTokens: number;
  baselineTokens: number;
}

record(entry: GainEntry): void          // append one line to ~/.kestrel/gain.jsonl
read(): GainEntry[]                      // parse, skip malformed lines
aggregate(entries, opts): Aggregate      // totals, percent, top ops, optional by-project
```
- Append is one `appendFileSync` of `JSON.stringify(entry) + "\n"`. Line writes are
  small and atomic enough for this use; no locking.
- Creates `~/.kestrel/` lazily.
- **All I/O failures are swallowed.** Gain is observability; it must never break a
  query or fail a command. Missing home dir, read-only FS, malformed lines → no-op /
  skip, never throw.

### `command.ts`
The `gain` citty subcommand.
```
kestrel gain
  queries:   142
  kestrel:   ~31k tok
  baseline:  ~590k tok
  saved:     ~559k tok (~95%)
  top ops:   find refs (61), view outline (40), find def (22)

kestrel gain --history       # last N entries, one per line
kestrel gain --by-project    # group totals by cwd
kestrel gain --json          # machine-readable aggregate
```
All numbers `~`-prefixed.

## Integration

`withEngine` (in `index.ts`) gains a post-step: after `fn` runs and the result is
emitted, if tracking is enabled, compute `filesIn(result)`, sum their byte sizes →
`baselineTokens`, take the emitted JSON byte length → `kestrelTokens`, and
`record(...)`. This requires `withEngine` (or `emit`) to see the result object and the
op name. Plan detail: thread the op label + captured result into the recording step;
keep the hook a single call so query paths are untouched otherwise.

Tracking enabled = `KESTREL_GAIN` not in `{"0","false"}` and `KESTREL_NO_GAIN` unset.

## Error handling

| Failure | Behavior |
| --- | --- |
| Cannot resolve home dir | skip recording, query unaffected |
| Ledger write fails (read-only FS, quota) | swallow, query unaffected |
| Ledger missing on `gain` | print "no gain recorded yet" |
| Malformed ledger line on read | skip that line |
| Result file unreadable when sizing baseline | count it as 0 bytes, continue |

## Testing (TDD, red first)

- `estimate`: 0→0, 4→1, 5→2 (rounding up).
- `filesIn`: nested `position.file`, top-level `file`, duplicates deduped, empty
  result → `[]`, non-object input → `[]`.
- `ledger`: append then read round-trips an entry; a malformed line is skipped, valid
  lines around it survive; `aggregate` math (sums, percent saved) and `--by-project`
  grouping; empty ledger → zeroed aggregate.
- `command`: seed a temp ledger (point the home dir at a tmp path), run `gain`, assert
  printed aggregate; `--json` shape; `--history` line count.
- Recording is exercised via the ledger tests directly (pure-ish), not by spawning the
  CLI, to keep tests fast and deterministic. The `withEngine` hook gets one test
  asserting an entry is appended when tracking is on and none when `KESTREL_GAIN=0`.

## Honesty guardrails

- Every reported figure `~`-prefixed.
- Baseline = result files only; never whole project.
- chars/4 documented as an estimate in `gain --help` and README.
- Privacy note in README: tracking is on by default and writes project paths + op
  names to `~/.kestrel/gain.jsonl`; disable with `KESTREL_GAIN=0`.

## Out of scope

- Real tokenizer accuracy.
- Per-query inline footer in query output (rejected: pollutes the agent contract).
- Recording for the MCP adapter (CLI only for v1; revisit if MCP wants the same).
