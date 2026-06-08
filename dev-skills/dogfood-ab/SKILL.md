---
name: dogfood-ab
description: Run an A/B dogfooding comparison to surface symantic op gaps — spawn two agents answering the same architecture question on a target repo, one using only symantic, one using only grep/Read, compare their answers and tooling, then verify and draft GitHub issues for confirmed gaps. Maintainer/dev tool for the symantic repo; not shipped in the plugin. Trigger on "/dogfood-ab", "A/B dogfood", "find symantic gaps", "compare symantic vs grep".
---

# dogfood-ab

A controlled experiment: two agents answer the **same** architecture question about a target
TypeScript repo — one restricted to the `symantic` CLI, one to grep/Read — and the gap between
their tooling logs surfaces what symantic can't do well yet. This is how issues #90–#101 were
found. One question per run keeps the comparison clean.

**Invocation:** `/dogfood-ab <target-dir> <question>`

## Loop

1. **Setup.** Confirm `symantic` is on PATH and built from current source (`cd packages/cli &&
   npm link`; `pnpm nadle build --reporter agent` if core/cli changed — the link points at
   `dist/`). Find the target's `tsconfig.json`.
2. **Spawn both arms in parallel** (one message, two `general-purpose` agents) with the prompts
   below, substituting `<target-dir>`, `<tsconfig>`, and `<question>`.
3. **Compare** the two results on: answer parity (did both reach the same *correct*
   architecture?), cost (symantic calls/tokens vs grep files/lines read), and the candidate
   gaps named in the symantic arm's FRICTION section.
4. **Verify each candidate gap** — reproduce it on **symantic's own fixtures**
   (`packages/core/src/__tests__/fixtures/sample`) or its **own dependencies**, never the
   target repo's code. Drop anything that doesn't reproduce or turns out to be operator error.
5. **Draft issues** for confirmed gaps: dupe-check `gh issue list`, write synthetic repro +
   `type:`/`severity:`/`scope:` labels (mirror existing issues).
6. **Show the drafts and wait for approval** before `gh issue create`. Never auto-file.

Stateless — the report lives in the conversation; the filed issues are the durable artifact.

## Hard rules

- **Private-code firewall.** The target repo is the *subject under test*, never quoted in a
  public issue. Every issue repro uses symantic's own fixtures/deps. If a gap only reproduces
  on private code, describe the *shape* synthetically or add a public fixture — never paste it.
- **Verify before filing.** Reproduce a gap (or drop it). The symantic arm's FRICTION is a
  lead, not a confirmed bug — agents misattribute (e.g. a bare name where a `::` path was
  needed reads as a "tool gap" but isn't).
- **Honest comparison.** Report when grep wins (it usually wins raw latency and cold-start
  orientation). The point is finding gaps, not declaring symantic the winner.

## Arm prompts

### symantic arm

> Answer this about `<target-dir>`:
>
> **<question>**
>
> TOOLING (strict): navigate TypeScript using the `symantic` CLI (on PATH) **only** — no Read
> tool on `.ts`/`.tsx` files, no grep/Glob/ripgrep for code search. tsconfig: `<tsconfig>` (run
> from `<target-dir>` or pass `--tsconfig`). The op set, addressing scheme, and orientation
> habit (`find symbol <part> --contains` when you don't know the file) are in the
> **using-symantic** skill — invoke it for the command reference. `--engine lsp` is the faster
> backend; fall back to the default engine if it misbehaves.
>
> DELIVERABLE — two sections:
> 1. **ANSWER**: concrete (name symbols/files/types), usable by a new engineer.
> 2. **TOOLING LOG**: numbered list of every symantic command, each with a one-line note
>    (helped / fell short). Then **FRICTION**: anything symantic couldn't do, was awkward,
>    confusing, or returned wrong; and any moment you wanted to fall back to grep/Read and
>    exactly why. Did you fall back? When and why. Be brutally honest — this measures tool gaps.

### grep arm

> Answer this about `<target-dir>`:
>
> **<question>**
>
> TOOLING (strict): use **only** the Read tool and text search (grep / ripgrep / Glob). No
> semantic code-intelligence CLI.
>
> DELIVERABLE — two sections:
> 1. **ANSWER**: concrete (name symbols/files/types), usable by a new engineer.
> 2. **TOOLING LOG**: numbered key steps. Then estimate total lines read + distinct files opened.

## Compare rubric

| Axis | What to record |
|---|---|
| Correctness | both right? either miss/hallucinate a collaborator? |
| Cost | symantic: tool calls + tokens · grep: files opened + lines read |
| Orientation | how each found the entry point with no file path given |
| Gaps | every FRICTION item → verified-real or dropped, with the fixture repro |

A round's payoff is the verified-gap list, not the winner.
