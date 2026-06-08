# symantic — Principles

The values that decide our roadmap and adjudicate tradeoffs. [VISION.md](./VISION.md) is _what_
we build and _why_; [DESIGN.md](./DESIGN.md) is _how_; this file is how we choose when those
pull against each other.

Every principle serves one consumer: **an AI agent in a query loop** — no cursor, a finite
context window, acting on what we return. A feature, op, or change earns its place by serving
that consumer better against the principles below.

## The principles

### 1. Correct over convenient

Compiler-accurate semantics, never a textual approximation. Same-named symbols, overloads,
shadowing, type-only references must resolve the way the type checker sees them.

**Why:** an agent _acts_ on our output. A wrong-but-fast or wrong-but-lean answer is worse than
useless — it sends the agent down a false path it can't easily detect. Correctness is the floor
nothing trades against.

### 2. Token-lean

Output is sized to an agent's context budget: compact trees, references classified and
paginated, no payload the agent has to pay to re-parse or re-address.

**Why:** tokens are the agent's real scarce resource. The whole reason to exist over reading
raw files is to spend fewer tokens for a more precise answer. Verbose-but-correct still loses.

### 3. Fast

Minimize latency in the agent's query loop. A warm core holds the project in memory across
calls; the analysis engine is swappable (ts-morph today, tsgo next) so speed improves without
changing the contract.

**Why:** latency stalls the agent's loop. Cold-start is the known tax — we attack it (warm
core, native engine), we never pay it down by cutting corners on correctness.

### 4. Name-addressed and re-feedable

Every result is a qualified name (`file.ts:Class::member`), never a byte offset. An address we
emit is valid input to the next query.

**Why:** an agent has no cursor to resolve an offset, and its work is a loop — find a symbol,
ask about it, drill in. Results that feed straight back into the next query are what make the
loop cheap. This is the core differentiator from raw LSP-over-MCP bridges.

### 5. Deterministic, never guess

No LLM inside symantic; output is compiler-derived and reproducible. When a name is ambiguous,
return the candidates — never silently pick one. Prose and interpretation are the calling
agent's job.

**Why:** the agent is already the language model. Our value is exact structure it can trust and
reproduce, not a second opinion. A silent guess is a correctness failure wearing a confident
face.

### 6. Honest failure

A miss is loud and diagnosable — a hint, or an error that restates the grammar — never a bare
empty result that reads as "nothing here." Empty, error, and not-found stay distinguishable.

**Why:** a silent empty is indistinguishable from a real "no results," so the agent draws the
wrong conclusion and stops looking. Every failure should tell the agent what to try next.

### 7. Compose, don't replace

symantic is the semantic layer, not a grep replacement. grep/find orient (locate files, search
text); symantic understands (resolve, reference, trace symbols). We borrow the proven semantic
engine and build the agent ergonomics on top.

**Why:** trying to be everything makes us worse at the one thing only we can do. The honest
division of labor — text search to orient, semantics to understand — is more useful to an agent
than a tool that pretends to cover both.

## When they tension

These pull against each other; we resolve case by case, not by a fixed ranking.

- **Correct vs fast.** The semantic engine has a cold-start cost on large projects. We eat the
  seconds (warm core, faster engine) — we never fake or approximate the answer to save them.
- **Token-lean vs complete.** Large result sets blow the budget. We cap, paginate, and offer
  count-only modes — and we say what was bounded. We never silently truncate, because a quiet
  cut reads as "that's all there is" (a violation of _honest failure_).
- **Fast vs deterministic.** Caching/heuristics can shave latency but risk a stale or guessed
  answer. We prefer a refresh-then-answer that's right over a fast answer that might be wrong.

The through-line: **correctness and honesty are not negotiable; speed and leanness are
optimized hard within that.**
