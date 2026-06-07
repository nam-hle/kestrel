#!/usr/bin/env node
/**
 * kestrel MCP server. Exposes the read-only core ops as MCP tools over stdio,
 * holding a warm engine per (tsconfig, engine-kind) across calls. Thin adapter —
 * no analysis logic. See docs/DESIGN.md Section 1.
 *
 * Tool names group by intent: view_* (read code), find_* (locate/trace), plus
 * top-level resolve/imports/exports/usage_report.
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

const server = new McpServer({ name: "kestrel", version: "0.1.0" });

/** The superset of arguments any kestrel tool accepts (all optional; per-tool schema validates). */
interface ToolArgs {
	name?: string;
	file?: string;
	limit?: number;
	depth?: number;
	full?: boolean;
	symbol?: string;
	cursor?: string;
	tsConfig: string;
	endLine?: number;
	contains?: boolean;
	startLine?: number;
	engine?: EngineKind;
	excludeTests?: boolean;
	direction?: "incoming" | "outgoing";
	context?: "none" | "snippet" | "block";
}

interface ToolSchema {
	description: string;
	inputSchema: Record<string, z.ZodTypeAny>;
}

type RegisterTool = (name: string, schema: ToolSchema, handler: (args: ToolArgs) => ToolResult | Promise<ToolResult>) => void;

/**
 * Register a tool under one or more names. The SDK's registerTool is generic over the exact
 * zod shape; we widen to a uniform (ToolArgs) handler here — each tool's own inputSchema still
 * validates args at the protocol boundary.
 */
const register = server.registerTool.bind(server) as unknown as RegisterTool;

function tool(names: string[], schema: ToolSchema, handler: (args: ToolArgs) => ToolResult | Promise<ToolResult>): void {
	for (const name of names) {
		register(name, schema, handler);
	}
}

// ---- top-level: addressing + whole-file facts ----

tool(
	["resolve"],
	{
		inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg },
		description: "Resolve a qualified name to a symbol, or candidates if ambiguous."
	},
	async ({ symbol, engine, tsConfig: tc }) => json(await engineFor(tc, kindOf(engine)).resolveSymbol(symbol!))
);

tool(
	["imports"],
	{ inputSchema: { tsConfig, file: fileArg, engine: engineArg }, description: "The import statements of a file (module wiring)." },
	async ({ file, engine, tsConfig: tc }) => json(await engineFor(tc, kindOf(engine)).listImports(file!))
);

tool(
	["exports"],
	{ inputSchema: { tsConfig, file: fileArg, engine: engineArg }, description: "Transitive public surface of an entry file (expands export *)." },
	async ({ file, engine, tsConfig: tc }) => json(await engineFor(tc, kindOf(engine)).publicSurface(file!))
);

tool(
	["usage_report"],
	{
		inputSchema: { tsConfig, file: fileArg, engine: engineArg, excludeTests: z.boolean().optional() },
		description: "Each public symbol of an entry with its reference counts (for dead-code analysis)."
	},
	async ({ file, engine, tsConfig: tc, excludeTests }) => json(await engineFor(tc, kindOf(engine)).usageReport(file!, { excludeTests }))
);

// ---- view: read code (structure + source) ----

tool(
	["view_outline"],
	{
		inputSchema: { tsConfig, file: fileArg, engine: engineArg, full: z.boolean().optional() },
		description: "Structural outline of a file (compact tree by default; full JSON with full=true)."
	},
	async ({ file, full, engine, tsConfig: tc }) => {
		const outline = await engineFor(tc, kindOf(engine)).outlineFile(file!);

		if (full === true) {
			return json(outline);
		}

		const { renderFileOutline } = await import("@kestrel/core");

		return text(renderFileOutline(file!, outline));
	}
);

tool(
	["view_symbol"],
	{ inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg }, description: "Exact source of a declaration (signature + body)." },
	async ({ symbol, engine, tsConfig: tc }) => json(await resolveOr(tc, kindOf(engine), symbol!, (e, s) => e.symbolSource(s)))
);

tool(
	["view_context"],
	{ inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg }, description: "Source + signature + outgoing callees + referenced type names." },
	async ({ symbol, engine, tsConfig: tc }) => json(await resolveOr(tc, kindOf(engine), symbol!, (e, s) => e.symbolContext(s)))
);

tool(
	["view_region"],
	{
		description: "A verbatim file slice by 1-based inclusive line range.",
		inputSchema: { tsConfig, file: fileArg, engine: engineArg, endLine: z.number(), startLine: z.number() }
	},
	async ({ file, engine, endLine, startLine, tsConfig: tc }) => json(await engineFor(tc, kindOf(engine)).readRegion(file!, startLine!, endLine!))
);

tool(
	["view_members"],
	{ description: "Members of a class / interface / namespace.", inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg } },
	async ({ symbol, engine, tsConfig: tc }) => json(await resolveOr(tc, kindOf(engine), symbol!, (e, s) => e.outlineSymbol(s)))
);

tool(
	["view_body"],
	{
		description: "Statement-level skeleton of a function body.",
		inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg, depth: z.number().optional() }
	},
	async ({ depth, symbol, engine, tsConfig: tc }) => json(await resolveOr(tc, kindOf(engine), symbol!, (e, s) => e.outlineFunction(s, { depth })))
);

// ---- find: locate + trace ----

tool(
	["find_symbol"],
	{
		inputSchema: { tsConfig, name: z.string(), engine: engineArg, contains: z.boolean().optional() },
		description: "Find a symbol by name across the whole project (exact, or substring with contains)."
	},
	async ({ name, engine, contains, tsConfig: tc }) => json(await engineFor(tc, kindOf(engine)).searchSymbol(name!, { contains }))
);

tool(
	["find_def"],
	{ description: "Find the declaration site(s) of a symbol.", inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg } },
	async ({ symbol, engine, tsConfig: tc }) => json(await resolveOr(tc, kindOf(engine), symbol!, (e, s) => e.findDefinition(s)))
);

tool(
	["find_refs"],
	{
		description: "Find references to a symbol, classified by kind; optionally exclude tests or attach context.",
		inputSchema: {
			tsConfig,
			engine: engineArg,
			symbol: symbolArg,
			limit: z.number().optional(),
			cursor: z.string().optional(),
			excludeTests: z.boolean().optional(),
			context: z.enum(["none", "snippet", "block"]).optional().describe("Surrounding source per ref (default none)")
		}
	},
	async ({ limit, symbol, cursor, engine, context, tsConfig: tc, excludeTests }) =>
		json(await resolveOr(tc, kindOf(engine), symbol!, (e, s) => e.findUsages(s, { limit, cursor, context, excludeTests })))
);

tool(
	["find_impls"],
	{ description: "Find implementations of an interface.", inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg } },
	async ({ symbol, engine, tsConfig: tc }) => json(await resolveOr(tc, kindOf(engine), symbol!, (e, s) => e.findImplementations(s)))
);

tool(
	["find_callers"],
	{
		description: "Incoming call hierarchy: who calls this symbol, to a depth.",
		inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg, depth: z.number().optional() }
	},
	async ({ depth, symbol, engine, tsConfig: tc }) =>
		json(await resolveOr(tc, kindOf(engine), symbol!, (e, s) => e.callHierarchy(s, { depth, direction: "incoming" })))
);

tool(
	["find_callees"],
	{
		description: "Outgoing call hierarchy: what this symbol calls, to a depth.",
		inputSchema: { tsConfig, engine: engineArg, symbol: symbolArg, depth: z.number().optional() }
	},
	async ({ depth, symbol, engine, tsConfig: tc }) =>
		json(await resolveOr(tc, kindOf(engine), symbol!, (e, s) => e.callHierarchy(s, { depth, direction: "outgoing" })))
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
