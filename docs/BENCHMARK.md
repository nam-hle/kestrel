# kestrel — Benchmark spec (the wedge proof)

Purpose: turn the asserted claims ("token-lean", "fewer false hits") into measured numbers.
This is Phase 0 of the [ROADMAP](./ROADMAP.md) and blocks the repositioning.

## Opponent

`mizchi/lsmcp` (a.k.a. typescript-mcp) — an LSP→MCP bridge **running on tsgo**
(`@typescript/native-preview`). Chosen deliberately: it shares the same compiler engine
class, so the comparison isolates **output ergonomics** (the thing kestrel claims) from
**engine speed** (which kestrel does not claim to win on). Beating a slower grep proves
nothing about the wedge; beating a tsgo-backed bridge does.

## What to measure

Per query, for each tool:

1. **Output tokens** — tokenize the raw tool result (use the same tokenizer for both;
   `tiktoken` cl100k or the model's tokenizer). This is the headline metric.
2. **False-hit rate** — for reference/usage queries on a symbol with same-named collisions:
   `(results that are NOT the queried symbol) / total results`. kestrel (semantic) should be
   0; textual or offset-confused output should be > 0. (lsmcp is semantic too, so this mostly
   tests whether kestrel's name-addressing avoids the ambiguity that byte-offset addressing
   forces the agent to re-disambiguate.)
3. **Calls-to-answer** — how many tool calls an agent needs to fully answer a fixed question
   (e.g. "what calls method X"). Synthesized ops (callHierarchy, usageReport) should need
   fewer than composing primitive LSP calls.
4. **Addressability** — can the result be fed into the next query without the agent computing
   a byte offset? Binary per tool. (kestrel: yes by design; LSP results carry line/char
   positions the agent must thread back.)

## Query set (fixed, on a real mid-size repo)

Pick a repo with namespaces, barrels, factory selectors, same-named symbols (the cases the
synthesized ops target). For each, the identical question is posed to both tools:

| #   | Question                          | kestrel op                  | lsmcp equivalent                     |
| --- | --------------------------------- | --------------------------- | ------------------------------------ |
| 1   | All usages of a same-named method | `usages` (member-addressed) | references (offset)                  |
| 2   | Who calls X, 2 levels deep        | `calls`                     | repeated references, agent-composed  |
| 3   | Public surface of a barrel entry  | `surface`                   | (no equivalent — must read files)    |
| 4   | Unused exports in a file          | `usage_report`              | (no equivalent — N references calls) |
| 5   | Structure of a namespaced file    | `outline_file` (tree)       | documentSymbol (flat, verbose)       |

Q3-Q5 are the differentiators: lsmcp has no single-call equivalent, so it must fall back to
multiple calls + file reads — that gap, in tokens + calls, is the proof.

## Method

1. Stand up both MCP servers on the same repo + tsconfig.
2. For each query, capture the raw tool result(s) from each server.
3. Tokenize results; count false hits; count calls-to-answer.
4. Emit a table: per query, kestrel vs lsmcp on the 4 metrics, plus totals.

## Presentation

A single reproducible script (`benchmark/run.ts`) + a results table in the README:

```
Query                     kestrel tokens  lsmcp tokens  Δ      kestrel calls  lsmcp calls
usages (same-named X)      …               …            -XX%   1              1
public surface            …               …            -XX%   1              3
unused exports            …               …            -XX%   1              N
```

**Exit:** the script runs end-to-end and produces the table. Honest reporting — where lsmcp
wins (e.g. raw engine speed, multi-language), say so. The claim is ergonomics, not speed.

## Notes / honesty

- Same tokenizer both sides, or the comparison is meaningless.
- Don't cherry-pick only the synthesized-op queries; include the primitive ones (1-2) where
  the gap is smaller, so the number is credible.
- Run on a repo neither tool's author controls.
