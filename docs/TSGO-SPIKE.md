# kestrel — tsgo engine notes

How kestrel can run on tsgo (the native TypeScript port) for speed, and the opt-in `LspEngine`
that does it. Background: tsgo is an escape hatch for cold-start, not a differentiator — the
differentiator is the output layer. ts-morph stays the default.

## Which door (decided)

- **Door 1 — Go-native embeddable API.** Not viable: no committed stable Go embedding API.
- **Door 2 — programmatic JS API** (`@typescript/native-preview/unstable/{sync,async,fs,proto}`).
  Spiked 2026-06-07: exposes typechecker primitives only (Checker/Program/Symbol) — **no
  find-references / implementations / language-service**. Using it would mean reinventing
  tsserver on the raw checker. Rejected.
- **Door 3 — tsgo as an LSP subprocess. CHOSEN + built.** `tsgo --lsp --stdio` advertises
  references/implementations/definition/callHierarchy/documentSymbol/rename — the full op set.
  This is how every tsgo-based tool (e.g. lsmcp) gets refs/impls. Byte offsets stay internal,
  translated to kestrel's `file:Name` + 1-based contract at the boundary.

`@typescript/native-preview` is WIP (`7.0.0-dev.*`), API/protocol churns — pin the version.

## LspEngine (built 2026-06-07)

Opt-in, in `packages/core`, additive. Design + plan:
`docs/superpowers/specs/2026-06-07-lsp-engine-design.md`,
`docs/superpowers/plans/2026-06-07-lsp-engine.md`.

- **Shape:** a `SymbolEngine` interface both engines satisfy; `LspEngine` is the async form
  (`AsyncSymbolEngine`). Semantic ops (resolve/refs/impls/definition/callHierarchy) → a warm
  `tsgo --lsp` subprocess; syntactic ops (imports, outline, function skeleton) → a
  `ts.createSourceFile` parser (the LSP can't serve those).
- **Addressing bridge:** `file:Name` → position via tsgo's own `documentSymbol` tree (no second
  semantic engine). Re-exports: tsgo lists an `export { X } from` specifier as a Variable at the
  barrel; a `textDocument/definition` hop reaches the true declaration.
- **Lifecycle:** lazy spawn, one tsgo per engine, warm for its lifetime, killed on `dispose()`.
  The client answers the server's `workspace/configuration` + `client/registerCapability`
  requests (else the handshake hangs), drains stderr, and times out requests (30s).
- **Tests:** parity vs the ts-morph engine on synthetic fixtures; gated to skip when the tsgo
  bin is absent, run in CI.

## Perf — real-repo A/B (743-LOC file)

| metric                    | ts-morph | tsgo-LSP | speedup |
| ------------------------- | -------: | -------: | ------: |
| cold load (first resolve) |  2786 ms |   962 ms |    2.9x |
| findUsages (hot symbol)   |   762 ms |    79 ms |    9.6x |
| outlineFile               |    12 ms |     3 ms |      4x |

## Parity (verified)

Both engines produce identical reference sets — same positions, not just counts (36/36, 6/6,
2/2 on the symbols tried). Two divergences found on a real file and fixed:

1. **Imports undercounted.** tsgo's `references` with `includeDeclaration:false` drops import
   sites with the declaration. Fix: request `includeDeclaration:true`, filter only the
   declaration's own name-token position — keep imports/re-exports.
2. **Body-locals leaked.** tsgo's `documentSymbol` descends into function bodies + variable
   initializers; ts-morph's resolver does not, so a bare name collided a top-level `const` with
   a same-named method-body local (false "ambiguous"). Fix: the bridge marks any symbol under a
   Function/Method/Constructor/Variable/Constant ancestor as a body-local and excludes it from
   bare-segment matches — mirroring ts-morph's `outlineDeclarations`.

Both have regression tests (`bridge.test.ts`, `lsp-engine.test.ts`).
