# Agents need name-addressing, not byte-offsets

> The persuasion piece deferred from [ADDRESSING.md](./ADDRESSING.md) (the grammar) and
> [PRINCIPLES.md](./PRINCIPLES.md#4-name-addressed-and-re-feedable) (the value). This is the
> standalone argument: _why_ a code-intelligence tool built for an AI agent must address symbols
> by name, and why the byte-offset model every LSP inherits actively fails that consumer.

## The consumer changed; the address model didn't

The Language Server Protocol was designed for an editor with a human at a cursor. Its core
currency is the **`Position`** — a `{ line, character }` pair — and its **`Location`** — a URI
plus a range of such positions. `textDocument/definition` returns a location; you click it; your
editor scrolls there. The offset is an instruction to a viewport, consumed by a human eye.

An AI agent is not that consumer. It has:

- **no cursor** — nothing to move to a `{ line, character }`;
- **no viewport** — a position points _at_ code the agent still has to fetch and read;
- **a finite context window** — every token spent re-reading code to resolve an offset is a
  token not spent reasoning;
- **a loop, not a glance** — its work is _find a symbol → ask about it → drill into the next_,
  many hops deep.

Hand that consumer an LSP-over-MCP bridge and the address model leaks straight through. The
agent asks "where is `handlePaste` defined?" and gets back `file:///…/saga.ts` at line 81,
character 8. To do anything with that, it must open the file, count to line 81, read around it,
and re-derive the name it _already had_ — burning context to translate an address built for an
eye into one a reasoner can use.

## Why the offset fails, concretely

**1. An offset is not re-feedable.** The output of one query cannot be the input to the next. The
agent's loop is `def → references → callers → members`; each step should consume the previous
step's result directly. `{ line: 81, character: 8 }` is not a thing you can _ask about_ — it has
to be resolved back to a symbol first, every hop, by reading source.

**2. An offset is fragile.** It is correct only against one exact revision of one file. Edit a
line above it and it silently points at the wrong code. A name (`saga.ts:handlePaste`) survives
edits that don't rename the symbol — it addresses the _declaration_, not a coordinate.

**3. An offset carries no meaning.** `line 81` tells the agent nothing about _what_ it found.
`saga.ts:NewFilter::onApplied` says: a member `onApplied`, nested in namespace `NewFilter`, in
`saga.ts`. The address is also a description — the agent can reason about it without fetching.

**4. Same-named symbols force a re-disambiguation.** Three `area` methods across `Shape`,
`Circle`, `Square` come back as three positions; the agent must open each to learn which is
which. Name-addressing returns `Shape::area`, `Circle::area`, `Square::area` — already
distinguished, each ready to query.

## What name-addressing buys

A **qualified name** — `src/foo.ts:Bar::method` — is the input to every symbol-taking op _and_
the shape of every symbol-shaped result (see [ADDRESSING.md](./ADDRESSING.md) for the grammar:
`file:name`, `::`-nesting, `#index` for collisions). The contract is a closed loop:

```
find symbol  handlePaste              → saga.ts:handlePaste
find refs    saga.ts:handlePaste      → 4 references, each a position you can region-read
view members saga.ts:WatchSaga        → WatchSaga::handle, WatchSaga::cancel   (re-feedable)
view symbol  saga.ts:WatchSaga::handle → the source, addressed, ready to trace further
```

Every arrow's output is a legal next input. The agent never computes an offset, never re-reads a
file to translate a coordinate, never re-disambiguates a same-named hit. **The loop is cheap
because the address is the answer _and_ the next question.**

Positions still exist — `file:line:col`, 1-based — but as **outputs only**: for a human, or for a
deliberate region read. They are never required as query input. (See
[ADDRESSING.md § Output addresses](./ADDRESSING.md#output-addresses).)

## This is the differentiator, not an implementation detail

It would be easy to read name-addressing as a cosmetic choice over the "real" work of semantic
analysis. It is the opposite. The semantic engine (ts-morph today, tsgo next) is **table
stakes** — any serious tool gets resolution right. What a tool built for an agent owns is the
**output contract**: results sized to a context budget, classified and paginated, and addressed
so they re-feed. An LSP-over-MCP bridge can be perfectly correct and still cost the agent dearly,
because it speaks the editor's address model to a consumer that has no cursor.

That is why symantic treats name-addressing as a [first-class principle](./PRINCIPLES.md), not a
formatting preference: _an address we emit is valid input to the next query._ Everything else —
token-leanness, honest failure, determinism — compounds on top of an address the agent can
actually use.

## A note to other tool authors

If you are building code intelligence for agents rather than editors: **emit names, accept
names.** Keep positions for humans and region reads, but make the symbol address — a stable,
descriptive, re-feedable qualified name — the spine of your contract. The grammar in
[ADDRESSING.md](./ADDRESSING.md) is one concrete shape of it (`file:Name::nested#index`); the
principle is larger than any one syntax. An address the agent can hand straight back is the
difference between a tool it loops through cheaply and one it pays to translate at every hop.

A conformance suite for third-party tools is future work, once the contract stabilizes past
`v0`.
