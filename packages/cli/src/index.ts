#!/usr/bin/env node
import { createEngine } from "@kestrel/core";
/**
 * kestrel CLI adapter. Translates CLI args <-> @kestrel/core calls and prints
 * results. No analysis logic. See docs/DESIGN.md Section 1.
 *
 * Commands group by agent intent: `view` (read code) and `find` (locate/trace),
 * plus top-level addressing / whole-file facts.
 */
import { runMain, defineCommand } from "citty";
import type { EngineKind, SymbolHandle, AsyncSymbolEngine } from "@kestrel/core";

function print(text: string): void {
	process.stdout.write(`${text}\n`);
}

function emit(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const tsconfig = { type: "string", required: true, description: "Path to the project tsconfig.json" } as const;
const engine = { type: "string", description: "Engine backend: tsmorph (default) or lsp (tsgo)" } as const;

function engineFrom(args: { engine?: string; tsconfig: string }): AsyncSymbolEngine {
	return createEngine({ tsConfigPath: args.tsconfig, engine: args.engine as EngineKind | undefined });
}

/** Run a command body with a fresh engine, disposing it after; clean error + non-zero exit on failure. */
async function withEngine(args: { engine?: string; tsconfig: string }, fn: (engine: AsyncSymbolEngine) => Promise<void>): Promise<void> {
	const engineInstance = engineFrom(args);

	try {
		await fn(engineInstance);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	} finally {
		await engineInstance.dispose();
	}
}

/** Resolve a name to a single symbol, or throw with the candidates / not-found result. */
async function resolveSymbolOrThrow(engineInstance: AsyncSymbolEngine, qualifiedName: string): Promise<SymbolHandle> {
	const result = await engineInstance.resolveSymbol(qualifiedName);

	if (result.kind === "symbol") {
		return result.symbol;
	}

	throw new Error(JSON.stringify(result, null, 2));
}

const symbolArg = { required: true, type: "positional", description: "file:name[#index]" } as const;
const fileArg = { required: true, type: "positional", description: "Relative file path" } as const;

// ---- top-level: addressing + whole-file facts ----

const resolve = defineCommand({
	args: { engine, tsconfig, symbol: symbolArg },
	meta: { name: "resolve", description: "Resolve a qualified name to a symbol or candidates" },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.resolveSymbol(args.symbol)));
	}
});

const imports = defineCommand({
	args: { engine, tsconfig, file: fileArg },
	meta: { name: "imports", description: "List the import statements of a file" },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.listImports(args.file)));
	}
});

const exportsCmd = defineCommand({
	args: { engine, tsconfig, file: fileArg },
	meta: { name: "exports", description: "Transitive public surface of an entry file (expands export *)" },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.publicSurface(args.file)));
	}
});

const usage = defineCommand({
	meta: { name: "usage", description: "Usage report: each public symbol of an entry with its reference counts" },
	args: { engine, tsconfig, file: fileArg, "exclude-tests": { type: "boolean", description: "Omit references in test files" } },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.usageReport(args.file, { excludeTests: args["exclude-tests"] === true })));
	}
});

// ---- view: read code (structure + source) ----

const viewOutline = defineCommand({
	meta: { name: "outline", description: "Outline the structure of a file (compact tree; --json for full)" },
	args: { engine, tsconfig, file: fileArg, json: { type: "boolean", description: "Emit full JSON instead of the compact tree" } },
	async run({ args }) {
		const { renderFileOutline } = await import("@kestrel/core");

		await withEngine(args, async (e) => {
			const outline = await e.outlineFile(args.file);

			if (args.json === true) {
				emit(outline);
			} else {
				print(renderFileOutline(args.file, outline));
			}
		});
	}
});

const viewFile = defineCommand({
	meta: { name: "file", description: "Token-lean whole file: outline, plus --body for each export's source" },
	args: { engine, tsconfig, file: fileArg, body: { type: "boolean", description: "Include each export's source" } },
	async run({ args }) {
		await withEngine(args, async (e) => {
			const outline = await e.outlineFile(args.file);

			if (args.body !== true) {
				emit(outline);

				return;
			}

			const sources = await Promise.all(
				outline.exports.map((m) =>
					m.qualifiedName !== undefined ? e.symbolSource({ position: m.position, qualifiedName: m.qualifiedName }) : Promise.resolve([])
				)
			);
			emit({ outline, sources: sources.flat() });
		});
	}
});

const viewSymbol = defineCommand({
	args: { engine, tsconfig, symbol: symbolArg },
	meta: { name: "symbol", description: "Print the exact source of a declaration" },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.symbolSource(await resolveSymbolOrThrow(e, args.symbol))));
	}
});

const viewMembers = defineCommand({
	args: { engine, tsconfig, symbol: symbolArg },
	meta: { name: "members", description: "Outline the members of a class/interface/namespace" },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.outlineSymbol(await resolveSymbolOrThrow(e, args.symbol))));
	}
});

const viewBody = defineCommand({
	meta: { name: "body", description: "Outline the statement skeleton of a function" },
	args: { engine, tsconfig, symbol: symbolArg, depth: { type: "string", description: "Nesting depth (default 1)" } },
	async run({ args }) {
		await withEngine(args, async (e) => {
			const symbol = await resolveSymbolOrThrow(e, args.symbol);
			emit(await e.outlineFunction(symbol, { depth: args.depth ? Number(args.depth) : undefined }));
		});
	}
});

const viewRegion = defineCommand({
	meta: { name: "region", description: "Print an addressed line range: file:Lstart-Lend" },
	args: { engine, tsconfig, target: { required: true, type: "positional", description: "file:Lstart-Lend" } },
	async run({ args }) {
		await withEngine(args, async (e) => {
			const m = /^(.*):(\d+)-(\d+)$/.exec(args.target);

			if (m === null) {
				throw new Error(`expected file:Lstart-Lend, got ${args.target}`);
			}

			emit(await e.readRegion(m[1]!, Number(m[2]), Number(m[3])));
		});
	}
});

const viewContext = defineCommand({
	args: { engine, tsconfig, symbol: symbolArg },
	meta: { name: "context", description: "Source + signature + callees + referenced types" },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.symbolContext(await resolveSymbolOrThrow(e, args.symbol))));
	}
});

// ---- find: locate + trace ----

const findSymbol = defineCommand({
	meta: { name: "symbol", description: "Search for a symbol by name across the whole project" },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.searchSymbol(args.name, { contains: args.contains })));
	},
	args: {
		engine,
		tsconfig,
		name: { required: true, type: "positional", description: "Symbol name" },
		contains: { type: "boolean", description: "Match the name as a substring (case-insensitive)" }
	}
});

const findDef = defineCommand({
	args: { engine, tsconfig, symbol: symbolArg },
	meta: { name: "def", description: "Find the declaration site(s) of a symbol" },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.findDefinition(await resolveSymbolOrThrow(e, args.symbol))));
	}
});

const findRefs = defineCommand({
	meta: { name: "refs", description: "Find usages of a symbol" },
	args: {
		engine,
		tsconfig,
		symbol: symbolArg,
		cursor: { type: "string", description: "Pagination cursor" },
		limit: { type: "string", description: "Max references to return" },
		"exclude-tests": { type: "boolean", description: "Omit references in test files" },
		context: { type: "string", description: "Surrounding source per ref: none (default) | snippet | block" }
	},
	async run({ args }) {
		await withEngine(args, async (e) => {
			const symbol = await resolveSymbolOrThrow(e, args.symbol);
			emit(
				await e.findUsages(symbol, {
					cursor: args.cursor,
					excludeTests: args["exclude-tests"] === true,
					limit: args.limit ? Number(args.limit) : undefined,
					context: args.context as "none" | "snippet" | "block" | undefined
				})
			);
		});
	}
});

const findImpls = defineCommand({
	args: { engine, tsconfig, symbol: symbolArg },
	meta: { name: "impls", description: "Find implementations of an interface" },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.findImplementations(await resolveSymbolOrThrow(e, args.symbol))));
	}
});

const findCallers = defineCommand({
	meta: { name: "callers", description: "Incoming call hierarchy: who calls this symbol" },
	args: { engine, tsconfig, symbol: symbolArg, depth: { type: "string", description: "Levels to walk (default 2)" } },
	async run({ args }) {
		await withEngine(args, async (e) => {
			const symbol = await resolveSymbolOrThrow(e, args.symbol);
			emit(await e.callHierarchy(symbol, { direction: "incoming", depth: args.depth ? Number(args.depth) : undefined }));
		});
	}
});

const findCallees = defineCommand({
	meta: { name: "callees", description: "Outgoing call hierarchy: what this symbol calls" },
	args: { engine, tsconfig, symbol: symbolArg, depth: { type: "string", description: "Levels to walk (default 2)" } },
	async run({ args }) {
		await withEngine(args, async (e) => {
			const symbol = await resolveSymbolOrThrow(e, args.symbol);
			emit(await e.callHierarchy(symbol, { direction: "outgoing", depth: args.depth ? Number(args.depth) : undefined }));
		});
	}
});

const view = defineCommand({
	meta: { name: "view", description: "Read code: structure + source" },
	subCommands: {
		file: viewFile,
		body: viewBody,
		symbol: viewSymbol,
		region: viewRegion,
		outline: viewOutline,
		members: viewMembers,
		context: viewContext
	}
});

const find = defineCommand({
	meta: { name: "find", description: "Locate + trace symbols" },
	subCommands: { def: findDef, refs: findRefs, impls: findImpls, symbol: findSymbol, callers: findCallers, callees: findCallees }
});

const main = defineCommand({
	subCommands: { view, find, usage, resolve, imports, exports: exportsCmd },
	meta: { name: "kestrel", description: "Semantic symbol queries for TypeScript" }
});

void runMain(main);
