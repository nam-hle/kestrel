# @symantic/cli

The `symantic` CLI — one-shot semantic code-navigation queries for TypeScript, built for AI agents.
Part of [symantic](https://github.com/nam-hle/symantic).

```bash
npx @symantic/cli view outline src/foo.ts     # no install
npm i -g @symantic/cli                         # → binary is `symantic`
```

The nearest `tsconfig.json` is auto-discovered from the cwd (`--tsconfig <path>` to override).
Output is token-lean, address-first text by default; add `--json` for the structured form, or
`--engine lsp` for the tsgo-backed engine.

Commands group by intent — **`view`** (read code) and **`find`** (locate / trace), plus
`resolve` / `imports` / `exports` / `usage` / `gain`:

```bash
symantic view symbol src/foo.ts:Bar           # exact source of one declaration
symantic view context src/foo.ts:Bar          # source + callees + referenced types
symantic find refs src/foo.ts:Bar --exclude-tests
symantic find callers src/foo.ts:Bar          # incoming call hierarchy
symantic gain                                  # estimated token savings to date
```

Run `symantic <command> --help` for flags. Full operation set and addressing scheme in the
[root README](https://github.com/nam-hle/symantic#readme).

## License

MIT
