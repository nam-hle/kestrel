#!/usr/bin/env node
/**
 * kestrel MCP server. Exposes the read-only core ops as MCP tools over stdio,
 * holding a warm ts-morph Project per tsconfig across calls (no per-call
 * cold start). Thin adapter — no analysis logic. See docs/DESIGN.md Section 1.
 */
import { z } from "zod";
import { Engine, renderFileOutline } from "@kestrel/core";
import type { SymbolHandle, ResolveResult } from "@kestrel/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

type ToolResult = { content: { type: "text"; text: string }[] };

/** Warm engines, keyed by tsconfig path — reused across tool calls. */
const engines = new Map<string, Engine>();

function engineFor(tsConfig: string): Engine {
	let engine = engines.get(tsConfig);

	if (engine === undefined) {
		engine = new Engine({ tsConfigPath: tsConfig });
		engines.set(tsConfig, engine);
	}

	return engine;
}

function json(value: unknown): ToolResult {
	return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function text(value: string): ToolResult {
	return { content: [{ text: value, type: "text" }] };
}

/** Resolve a symbol then run an op; if not a single symbol, return the resolve result as JSON. */
function resolveOr(tc: string, qualifiedName: string, op: (engine: Engine, symbol: SymbolHandle) => unknown): unknown | ResolveResult {
	const engine = engineFor(tc);
	const result = engine.resolveSymbol(qualifiedName);

	return result.kind === "symbol" ? op(engine, result.symbol) : result;
}

const tsConfig = z.string().describe("Path to the project tsconfig.json");
const symbolArg = z.string().describe("Qualified name: relPath:Name (dotted for namespaces/members, Name#index to disambiguate)");
const fileArg = z.string().describe("Source file path, relative to the tsconfig directory");

const server = new McpServer({ name: "kestrel", version: "0.0.0" });

server.registerTool(
	"resolve",
	{ inputSchema: { tsConfig, symbol: symbolArg }, description: "Resolve a qualified name to a symbol, or candidates if ambiguous." },
	({ symbol, tsConfig: tc }) => json(engineFor(tc).resolveSymbol(symbol))
);

server.registerTool(
	"search",
	{
		inputSchema: { tsConfig, name: z.string(), contains: z.boolean().optional() },
		description: "Find a symbol by name across the whole project (exact, or substring with contains)."
	},
	({ name, contains, tsConfig: tc }) => json(engineFor(tc).searchSymbol(name, { contains }))
);

server.registerTool(
	"definition",
	{ inputSchema: { tsConfig, symbol: symbolArg }, description: "Find the declaration site(s) of a symbol." },
	({ symbol, tsConfig: tc }) => json(resolveOr(tc, symbol, (e, s) => e.findDefinition(s)))
);

server.registerTool(
	"usages",
	{
		description: "Find references to a symbol, classified by kind; optionally exclude tests.",
		inputSchema: { tsConfig, symbol: symbolArg, limit: z.number().optional(), cursor: z.string().optional(), excludeTests: z.boolean().optional() }
	},
	({ limit, symbol, cursor, tsConfig: tc, excludeTests }) => json(resolveOr(tc, symbol, (e, s) => e.findUsages(s, { limit, cursor, excludeTests })))
);

server.registerTool(
	"calls",
	{
		description: "Call hierarchy: callers (incoming) or callees (outgoing) of a symbol, to a depth.",
		inputSchema: { tsConfig, symbol: symbolArg, depth: z.number().optional(), direction: z.enum(["incoming", "outgoing"]).optional() }
	},
	({ depth, symbol, direction, tsConfig: tc }) => json(resolveOr(tc, symbol, (e, s) => e.callHierarchy(s, { depth, direction })))
);

server.registerTool(
	"implementations",
	{ inputSchema: { tsConfig, symbol: symbolArg }, description: "Find implementations of an interface." },
	({ symbol, tsConfig: tc }) => json(resolveOr(tc, symbol, (e, s) => e.findImplementations(s)))
);

server.registerTool(
	"outline_file",
	{
		inputSchema: { tsConfig, file: fileArg, full: z.boolean().optional() },
		description: "Structural outline of a file (compact tree by default; full JSON with full=true)."
	},
	({ file, full, tsConfig: tc }) => {
		const outline = engineFor(tc).outlineFile(file);

		return full === true ? json(outline) : text(renderFileOutline(file, outline));
	}
);

server.registerTool(
	"outline_symbol",
	{ inputSchema: { tsConfig, symbol: symbolArg }, description: "Members of a class / interface / namespace." },
	({ symbol, tsConfig: tc }) => json(resolveOr(tc, symbol, (e, s) => e.outlineSymbol(s)))
);

server.registerTool(
	"outline_function",
	{ description: "Statement-level skeleton of a function body.", inputSchema: { tsConfig, symbol: symbolArg, depth: z.number().optional() } },
	({ depth, symbol, tsConfig: tc }) => json(resolveOr(tc, symbol, (e, s) => e.outlineFunction(s, { depth })))
);

server.registerTool(
	"imports",
	{ inputSchema: { tsConfig, file: fileArg }, description: "The import statements of a file (module wiring)." },
	({ file, tsConfig: tc }) => json(engineFor(tc).listImports(file))
);

server.registerTool(
	"surface",
	{ inputSchema: { tsConfig, file: fileArg }, description: "Transitive public surface of an entry file (expands export *)." },
	({ file, tsConfig: tc }) => json(engineFor(tc).publicSurface(file))
);

server.registerTool(
	"usage_report",
	{
		inputSchema: { tsConfig, file: fileArg, excludeTests: z.boolean().optional() },
		description: "Each public symbol of an entry with its reference counts (for dead-code analysis)."
	},
	({ file, tsConfig: tc, excludeTests }) => json(engineFor(tc).usageReport(file, { excludeTests }))
);

await server.connect(new StdioServerTransport());
