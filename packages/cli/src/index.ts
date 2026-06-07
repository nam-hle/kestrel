#!/usr/bin/env node
import { createEngine } from "@kestrel/core";
/**
 * kestrel CLI adapter. Translates CLI args <-> @kestrel/core calls and prints
 * results. No analysis logic. See docs/DESIGN.md Section 1.
 */
import { runMain, defineCommand } from "citty";
import type { EngineKind, SymbolHandle, AsyncSymbolEngine } from "@kestrel/core";

function print(text: string): void {
	process.stdout.write(`${text}\n`);
}

const tsconfig = {
	type: "string",
	required: true,
	description: "Path to the project tsconfig.json"
} as const;

const engine = {
	type: "string",
	description: "Engine backend: tsmorph (default) or lsp (tsgo)"
} as const;

function engineFrom(args: { engine?: string; tsconfig: string }): AsyncSymbolEngine {
	return createEngine({ tsConfigPath: args.tsconfig, engine: args.engine as EngineKind | undefined });
}

function emit(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Run a command body with a freshly-created engine, disposing it afterwards and printing a
 * clean error (no stack trace) + exiting non-zero on failure.
 */
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

const resolve = defineCommand({
	meta: { name: "resolve", description: "Resolve a qualified name to a symbol or candidates" },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.resolveSymbol(args.symbol)));
	},
	args: { engine, tsconfig, symbol: { required: true, type: "positional", description: "file:name[#index]" } }
});

const search = defineCommand({
	meta: { name: "search", description: "Search for a symbol by name across the whole project" },
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

const def = defineCommand({
	meta: { name: "def", description: "Find the declaration site(s) of a symbol" },
	args: { engine, tsconfig, symbol: { required: true, type: "positional", description: "file:name[#index]" } },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.findDefinition(await resolveSymbolOrThrow(e, args.symbol))));
	}
});

const refs = defineCommand({
	meta: { name: "refs", description: "Find usages of a symbol" },
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
	},
	args: {
		engine,
		tsconfig,
		cursor: { type: "string", description: "Pagination cursor" },
		limit: { type: "string", description: "Max references to return" },
		symbol: { required: true, type: "positional", description: "file:name[#index]" },
		"exclude-tests": { type: "boolean", description: "Omit references in test files" },
		context: { type: "string", description: "Surrounding source per ref: none (default) | snippet | block" }
	}
});

const calls = defineCommand({
	meta: { name: "calls", description: "Call hierarchy: callers (incoming) or callees (outgoing) of a symbol" },
	args: {
		engine,
		tsconfig,
		depth: { type: "string", description: "Levels to walk (default 2)" },
		outgoing: { type: "boolean", description: "Show callees instead of callers" },
		symbol: { required: true, type: "positional", description: "file:name[#index]" }
	},
	async run({ args }) {
		await withEngine(args, async (e) => {
			const symbol = await resolveSymbolOrThrow(e, args.symbol);

			emit(
				await e.callHierarchy(symbol, {
					depth: args.depth ? Number(args.depth) : undefined,
					direction: args.outgoing === true ? "outgoing" : "incoming"
				})
			);
		});
	}
});

const impls = defineCommand({
	meta: { name: "impls", description: "Find implementations of an interface" },
	args: { engine, tsconfig, symbol: { required: true, type: "positional", description: "file:name[#index]" } },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.findImplementations(await resolveSymbolOrThrow(e, args.symbol))));
	}
});

const outlineFile = defineCommand({
	meta: { name: "outline-file", description: "Outline the structure of a file (compact tree; --json for full)" },
	args: {
		engine,
		tsconfig,
		file: { required: true, type: "positional", description: "Relative file path" },
		json: { type: "boolean", description: "Emit full JSON instead of the compact tree" }
	},
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

const imports = defineCommand({
	meta: { name: "imports", description: "List the import statements of a file" },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.listImports(args.file)));
	},
	args: { engine, tsconfig, file: { required: true, type: "positional", description: "Relative file path" } }
});

const surface = defineCommand({
	meta: { name: "surface", description: "Transitive public surface of an entry file (expands export *)" },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.publicSurface(args.file)));
	},
	args: { engine, tsconfig, file: { required: true, type: "positional", description: "Entry file path" } }
});

const usage = defineCommand({
	meta: { name: "usage", description: "Usage report: each public symbol of an entry with its reference counts" },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.usageReport(args.file, { excludeTests: args["exclude-tests"] === true })));
	},
	args: {
		engine,
		tsconfig,
		file: { required: true, type: "positional", description: "Entry file path" },
		"exclude-tests": { type: "boolean", description: "Omit references in test files" }
	}
});

const outlineSymbol = defineCommand({
	meta: { name: "outline-symbol", description: "Outline the members of a class/interface" },
	args: { engine, tsconfig, symbol: { required: true, type: "positional", description: "file:name[#index]" } },
	async run({ args }) {
		await withEngine(args, async (e) => emit(await e.outlineSymbol(await resolveSymbolOrThrow(e, args.symbol))));
	}
});

const outlineFn = defineCommand({
	meta: { name: "outline-fn", description: "Outline the statement skeleton of a function" },
	args: {
		engine,
		tsconfig,
		depth: { type: "string", description: "Nesting depth (default 1)" },
		symbol: { required: true, type: "positional", description: "file:name[#index]" }
	},
	async run({ args }) {
		await withEngine(args, async (e) => {
			const symbol = await resolveSymbolOrThrow(e, args.symbol);

			emit(await e.outlineFunction(symbol, { depth: args.depth ? Number(args.depth) : undefined }));
		});
	}
});

const main = defineCommand({
	meta: { name: "kestrel", description: "Semantic symbol queries for TypeScript" },
	subCommands: {
		def,
		refs,
		calls,
		impls,
		usage,
		search,
		imports,
		resolve,
		surface,
		"outline-fn": outlineFn,
		"outline-file": outlineFile,
		"outline-symbol": outlineSymbol
	}
});

void runMain(main);
