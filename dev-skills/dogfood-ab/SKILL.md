---
name: dogfood-ab
description: Run an A/B dogfooding comparison to surface symantic op gaps — spawn two agents answering the same fixed architecture question on a target repo, one preferring symantic but allowed grep, one using only grep/Read, compare their answers and tooling, then verify and draft GitHub issues for confirmed gaps. Maintainer/dev tool for the symantic repo; not shipped in the plugin. Trigger on "/dogfood-ab", "A/B dogfood", "find symantic gaps", "compare symantic vs grep".
---

# dogfood-ab

A controlled experiment: two agents answer the **same fixed** architecture question about a
target TypeScript repo — one _prefers_ the `symantic` CLI but may fall back to grep/Read, one
uses only grep/Read — and the gap between their tooling logs surfaces what symantic can't do
well yet. This is how issues #90–#105 were found.

**Two deliberate design choices:**

- **The symantic arm may use grep** (preferring symantic first). This mirrors a real
  unconstrained agent. The signal is no longer "what symantic can't do at all" but the sharper
  **every moment the agent reached for grep over symantic, and why** — each such reach is a
  candidate gap from realistic usage, not an artificial constraint.
- **One fixed question, reused across rounds/repos.** The same question is asked every round so
  the experiment tracks symantic _converging to grep parity over time_: a gap found in round N
  should be gone (the agent no longer falls back for it) in round N+1 after the fix ships. The
  canonical question lives in **Fixed question** below; pass it unchanged unless explicitly
  overridden.

**Invocation:** `/dogfood-ab <target-dir> [question]` — `question` defaults to the Fixed
question; only override to start a _new_ tracking series.

## Fixed question

> How does the primary state-mutation flow work end-to-end in this engine — from the UI
> event/action through the store/reducer/saga to the re-rendered view? Name the key types, the
> action/state holder, where the work is applied (client store and/or server), and the data
> flow.

This is deliberately generic so it applies to every A12 \*-engine repo (tree, overview,
relationship, …) and exercises the same op mix each round (orientation → action/state →
saga/middleware → reducer → selector → render): `find symbol --contains`, `view outline`,
`view symbol`/`members`/`context`, `find refs`/`callers`. Keep it stable so round-over-round
fallback counts are comparable.

## Loop

1. **Setup.** Confirm `symantic` is on PATH and built from current source (`cd packages/cli &&
npm link`; `pnpm nadle build --reporter agent` if core/cli changed — the link points at
   `dist/`). Find the target's `tsconfig.json`.
2. **Spawn both arms in parallel** (one message, two `general-purpose` agents) with the prompts
   below, substituting `<target-dir>`, `<tsconfig>`, and `<question>` (the Fixed question unless
   overridden).
3. **Compare** the two results on: answer parity (did both reach the same _correct_
   architecture?), cost, orientation, and — the headline metric — **the symantic arm's
   grep-fallback list**: every place it reached for grep/Read over symantic, with the reason.
   Compare that list against prior rounds' (see **Tracking** below): which past fallbacks are
   gone (fixed), which recur, which are new.
4. **Verify each candidate gap** — reproduce it on **symantic's own fixtures**
   (`packages/core/src/__tests__/fixtures/sample`) or its **own dependencies**, never the
   target repo's code. Drop anything that doesn't reproduce or turns out to be operator error
   (a fallback the agent took out of habit, where a symantic op would have worked, is _not_ a
   gap — note it as operator error).
5. **Draft issues** for confirmed gaps: dupe-check `gh issue list`, write synthetic repro +
   `type:`/`severity:`/`scope:` labels (mirror existing issues).
6. **Show the drafts and wait for approval** before `gh issue create`. Never auto-file.

## Tracking (convergence over time)

Because the question is fixed, fallbacks are comparable across rounds. Maintain a short ledger
in `dev-skills/dogfood-ab/LEDGER.md` (one line per round): repo, date, fixed-question version,
the grep-fallback count, and the issue numbers filed. Each round, open it first and report the
delta — falling fallback count round-over-round is the success metric. Append the new row after
the run. (The conversation is ephemeral; the ledger + filed issues are the durable artifacts.)

## Hard rules

- **Private-code firewall.** The target repo is the _subject under test_, never quoted in a
  public issue. Every issue repro uses symantic's own fixtures/deps. If a gap only reproduces
  on private code, describe the _shape_ synthetically or add a public fixture — never paste it.
- **Verify before filing.** Reproduce a gap (or drop it). A grep fallback is a _lead_, not a
  confirmed bug — agents misattribute (e.g. a bare name where a `::` path was needed reads as a
  "tool gap" but isn't), and an agent with grep available will sometimes reach for it out of
  habit where symantic would have served. Re-run the symantic op yourself before believing the
  fallback was necessary.
- **Honest comparison.** Report when grep wins (it usually wins raw latency, cold-start
  orientation, and reading prose docs symantic can't see). The point is finding gaps, not
  declaring symantic the winner.

## Arm prompts

### symantic arm (symantic-preferred, grep allowed)

> Answer this about `<target-dir>`:
>
> **<question>**
>
> TOOLING: **prefer the `symantic` CLI** (on PATH) for all TypeScript navigation — reach for it
> first for every "where is this / what's its shape / who calls it" question. You **may** fall
> back to grep/ripgrep/Glob/Read, but treat every fallback as a cost: before falling back, try
> the symantic op that should serve it. **Use `--engine lsp` on every symantic command** (the
> faster tsgo backend); only drop it for a single command if lsp errors or returns clearly
> wrong/empty output. tsconfig: `<tsconfig>` (run from `<target-dir>` or pass `--tsconfig`). The
> op set, addressing scheme, and orientation habit (`find symbol <part> --contains` when you
> don't know the file) are in the **using-symantic** skill — invoke it for the command reference.
>
> Before grepping: if you're orienting by a _concept_ (e.g. "where is X triggered?", "is there
> a Y layer?"), cast `find symbol <fragment> --contains` with a broad fragment of the concept
> _first_ — it spans the whole project incl. directories you haven't opened, so grepping instead
> risks missing code that lives where you didn't look. Nested decls are `::`-addressable
> (`view symbol Owner::member`) — don't Read a line range for one member. These two habits are
> exactly what prior rounds got wrong; reaching for grep where one of these would serve counts
> as a fallback to log, not a gap.
>
> DELIVERABLE — two sections:
>
> 1. **ANSWER**: concrete (name symbols/files/types), usable by a new engineer.
> 2. **TOOLING LOG**: numbered list of every command — symantic _and_ grep/Read — each with a
>    one-line note (helped / fell short). Then **FALLBACKS**: a numbered list of every moment you
>    used grep/Read instead of symantic — for each, state the exact symantic op you tried first
>    (or why you didn't try one), what it returned, and why grep was necessary. Be brutally
>    honest: this fallback list is the experiment's primary measurement.

### grep arm

> Answer this about `<target-dir>`:
>
> **<question>**
>
> TOOLING (strict): use **only** the Read tool and text search (grep / ripgrep / Glob). No
> semantic code-intelligence CLI.
>
> DELIVERABLE — two sections:
>
> 1. **ANSWER**: concrete (name symbols/files/types), usable by a new engineer.
> 2. **TOOLING LOG**: numbered key steps. Then estimate total lines read + distinct files opened.

## Compare rubric

| Axis        | What to record                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Correctness | both right? either miss/hallucinate a collaborator? did symantic miss context grep got from prose docs? |
| Cost        | both arms: tool calls + tokens · grep: files opened + lines read                                        |
| Orientation | how each found the entry point with no file path given                                                  |
| Fallbacks   | every grep-over-symantic reach → verified-gap or operator-error, with the fixture repro                 |
| Convergence | fallback count vs prior rounds (the ledger): fixed / recurring / new                                    |

A round's payoff is the verified-gap list and the falling fallback count, not the winner.
