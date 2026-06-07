#!/usr/bin/env node
/**
 * kestrel MCP server. Exposes the read-only core ops as MCP tools over stdio,
 * holding a warm engine per (tsconfig, engine-kind) across calls (no per-call
 * cold start). Thin adapter — no analysis logic. See docs/DESIGN.md Section 1.
 */
import { z } from "zod";
import { createEngine } from "@kestrel/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { EngineKind, SymbolHandle, ResolveResult, AsyncSymbolEngine } from "@kestrel/core";

type ToolResult = { content: { type: "text"; text: string }[] };

/** Warm engines, keyed by `tsconfig::engineKind` — reused across tool calls. */
const engines = new Map<string, AsyncSymbolEngine>();

function engineFor(tsConfig: string, kind: EngineKind): AsyncSymbolEngine {
	const key = `${tsConfig}::${kind}`;
	let engine = engines.get(key);

	if (engine === undefined) {
		engine = createEngine({ engine: kind, tsConfigPath: tsConfig });
		engines.set(key, engine);
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
async function resolveOr(
	tc: string,
	kind: EngineKind,
	qualifiedName: string,
	op: (engine: AsyncSymbolEngine, symbol: SymbolHandle) => Promise<unknown>
): Promise<unknown | ResolveResult> {
	const engine = engineFor(tc, kind);
	const result = await engine.resolveSymbol(qualifiedName);

	return result.kind === "symbol" ? op(engine, result.symbol) : result;
}

const tsConfig = z.string().describe("Path to the project tsconfig.json");
const engineArg = z.enum(["tsmorph", "lsp"]).optional().describe("Engine backend (default tsmorph)");
const symbolArg = z.string().describe("Qualified name: relPath:Name (dotted for namespaces/members, Name#index to disambiguate)");
const fileArg = z.string().describe("Source file path, relative to the tsconfig directory");

const kindOf = (engine: EngineKind | undefined): EngineKind => engine ?? "tsmorph";

const server = new McpServer({ name: "kestrel", version: "0.0.0" });

server.registerTool(
	"resolve",
	{
		inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg },
		description: "Resolve a qualified name to a symbol, or candidates if ambiguous."
	},
	async ({ symbol, engine, tsConfig: tc }) => json(await engineFor(tc, kindOf(engine)).resolveSymbol(symbol))
);

server.registerTool(
	"search",
	{
		inputSchema: { tsConfig, name: z.string(), engine: engineArg, contains: z.boolean().optional() },
		description: "Find a symbol by name across the whole project (exact, or substring with contains)."
	},
	async ({ name, engine, contains, tsConfig: tc }) => json(await engineFor(tc, kindOf(engine)).searchSymbol(name, { contains }))
);

server.registerTool(
	"definition",
	{ description: "Find the declaration site(s) of a symbol.", inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg } },
	async ({ symbol, engine, tsConfig: tc }) => json(await resolveOr(tc, kindOf(engine), symbol, (e, s) => e.findDefinition(s)))
);

server.registerTool(
	"usages",
	{
		description: "Find references to a symbol, classified by kind; optionally exclude tests.",
		inputSchema: {
			tsConfig,
			engine: engineArg,
			symbol: symbolArg,
			limit: z.number().optional(),
			cursor: z.string().optional(),
			excludeTests: z.boolean().optional()
		}
	},
	async ({ limit, symbol, cursor, engine, tsConfig: tc, excludeTests }) =>
		json(await resolveOr(tc, kindOf(engine), symbol, (e, s) => e.findUsages(s, { limit, cursor, excludeTests })))
);

server.registerTool(
	"calls",
	{
		description: "Call hierarchy: callers (incoming) or callees (outgoing) of a symbol, to a depth.",
		inputSchema: {
			tsConfig,
			engine: engineArg,
			symbol: symbolArg,
			depth: z.number().optional(),
			direction: z.enum(["incoming", "outgoing"]).optional()
		}
	},
	async ({ depth, symbol, engine, direction, tsConfig: tc }) =>
		json(await resolveOr(tc, kindOf(engine), symbol, (e, s) => e.callHierarchy(s, { depth, direction })))
);

server.registerTool(
	"implementations",
	{ description: "Find implementations of an interface.", inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg } },
	async ({ symbol, engine, tsConfig: tc }) => json(await resolveOr(tc, kindOf(engine), symbol, (e, s) => e.findImplementations(s)))
);

server.registerTool(
	"outline_file",
	{
		inputSchema: { tsConfig, file: fileArg, engine: engineArg, full: z.boolean().optional() },
		description: "Structural outline of a file (compact tree by default; full JSON with full=true)."
	},
	async ({ file, full, engine, tsConfig: tc }) => {
		const outline = await engineFor(tc, kindOf(engine)).outlineFile(file);

		if (full === true) {
			return json(outline);
		}

		const { renderFileOutline } = await import("@kestrel/core");

		return text(renderFileOutline(file, outline));
	}
);

server.registerTool(
	"outline_symbol",
	{ description: "Members of a class / interface / namespace.", inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg } },
	async ({ symbol, engine, tsConfig: tc }) => json(await resolveOr(tc, kindOf(engine), symbol, (e, s) => e.outlineSymbol(s)))
);

server.registerTool(
	"outline_function",
	{
		description: "Statement-level skeleton of a function body.",
		inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg, depth: z.number().optional() }
	},
	async ({ depth, symbol, engine, tsConfig: tc }) => json(await resolveOr(tc, kindOf(engine), symbol, (e, s) => e.outlineFunction(s, { depth })))
);

server.registerTool(
	"imports",
	{ inputSchema: { tsConfig, file: fileArg, engine: engineArg }, description: "The import statements of a file (module wiring)." },
	async ({ file, engine, tsConfig: tc }) => json(await engineFor(tc, kindOf(engine)).listImports(file))
);

server.registerTool(
	"surface",
	{ inputSchema: { tsConfig, file: fileArg, engine: engineArg }, description: "Transitive public surface of an entry file (expands export *)." },
	async ({ file, engine, tsConfig: tc }) => json(await engineFor(tc, kindOf(engine)).publicSurface(file))
);

server.registerTool(
	"usage_report",
	{
		inputSchema: { tsConfig, file: fileArg, engine: engineArg, excludeTests: z.boolean().optional() },
		description: "Each public symbol of an entry with its reference counts (for dead-code analysis)."
	},
	async ({ file, engine, tsConfig: tc, excludeTests }) => json(await engineFor(tc, kindOf(engine)).usageReport(file, { excludeTests }))
);

// Dispose warm engines (and any tsgo subprocess) on shutdown. See #44 for fuller lifecycle.
async function disposeAll(): Promise<void> {
	await Promise.all([...engines.values()].map((e) => e.dispose()));
	engines.clear();
}

function shutdownOn(signal: "SIGINT" | "SIGTERM"): void {
	process.once(signal, () => {
		void disposeAll().finally(() => {
			// Re-raise with no listener so Node's default terminates the process (avoids process.exit).
			process.kill(process.pid, signal);
		});
	});
}

shutdownOn("SIGINT");
shutdownOn("SIGTERM");

await server.connect(new StdioServerTransport());
