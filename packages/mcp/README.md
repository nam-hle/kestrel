# @symantic/mcp

The [symantic](https://github.com/nam-hle/symantic) MCP server — semantic TypeScript code navigation
exposed as [Model Context Protocol](https://modelcontextprotocol.io) tools over stdio. It holds the
project warm across calls, so there's no per-query cold start.

```bash
npx @symantic/mcp        # binary: symantic-mcp
```

Host setup (Claude Code shown; Cursor / Codex in the root README):

```json
{ "mcpServers": { "symantic": { "command": "npx", "args": ["-y", "@symantic/mcp"] } } }
```

Tools: `view_outline`, `view_symbol`, `view_context`, `view_region`, `view_members`, `view_body`,
`find_symbol`, `find_def`, `find_refs`, `find_impls`, `find_callers`, `find_callees`, `resolve`,
`imports`, `exports`, `usage_report`. Each takes a `tsConfig` argument (engine cached per tsconfig);
pass `engine: "lsp"` for the tsgo backend or `json: true` for structured output.

Results are name-addressed and token-lean — see the
[root README](https://github.com/nam-hle/symantic#readme).

## License

MIT
