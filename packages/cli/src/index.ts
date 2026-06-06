#!/usr/bin/env node
import { Engine } from "@kestrel/core";
/**
 * kestrel CLI adapter. Translates CLI args <-> @kestrel/core calls and prints
 * JSON results. No analysis logic. See docs/DESIGN.md Section 1.
 */
import { runMain, defineCommand } from "citty";
import type { EngineOptions } from "@kestrel/core";

const tsconfig = {
	type: "string",
	required: true,
	description: "Path to the project tsconfig.json"
} as const;

function engineFrom(args: { tsconfig: string }): Engine {
	const options: EngineOptions = { tsConfigPath: args.tsconfig };

	return new Engine(options);
}

function emit(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const resolve = defineCommand({
	run({ args }) {
		emit(engineFrom(args).resolveSymbol(args.symbol));
	},
	meta: { name: "resolve", description: "Resolve a qualified name to a symbol or candidates" },
	args: { tsconfig, symbol: { required: true, type: "positional", description: "file:name[#index]" } }
});

const search = defineCommand({
	meta: { name: "search", description: "Search for a symbol by name across the whole project" },
	run({ args }) {
		emit(engineFrom(args).searchSymbol(args.name, { contains: args.contains }));
	},
	args: {
		tsconfig,
		name: { required: true, type: "positional", description: "Symbol name" },
		contains: { type: "boolean", description: "Match the name as a substring (case-insensitive)" }
	}
});

const def = defineCommand({
	meta: { name: "def", description: "Find the declaration site(s) of a symbol" },
	args: { tsconfig, symbol: { required: true, type: "positional", description: "file:name[#index]" } },
	run({ args }) {
		const engine = engineFrom(args);

		emit(engine.findDefinition(resolveSymbolOrThrow(engine, args.symbol)));
	}
});

const refs = defineCommand({
	meta: { name: "refs", description: "Find usages of a symbol" },
	run({ args }) {
		const engine = engineFrom(args);
		const symbol = resolveSymbolOrThrow(engine, args.symbol);

		emit(engine.findUsages(symbol, { cursor: args.cursor, limit: args.limit ? Number(args.limit) : undefined }));
	},
	args: {
		tsconfig,
		cursor: { type: "string", description: "Pagination cursor" },
		limit: { type: "string", description: "Max references to return" },
		symbol: { required: true, type: "positional", description: "file:name[#index]" }
	}
});

const impls = defineCommand({
	meta: { name: "impls", description: "Find implementations of an interface" },
	args: { tsconfig, symbol: { required: true, type: "positional", description: "file:name[#index]" } },
	run({ args }) {
		const engine = engineFrom(args);

		emit(engine.findImplementations(resolveSymbolOrThrow(engine, args.symbol)));
	}
});

const outlineFile = defineCommand({
	run({ args }) {
		emit(engineFrom(args).outlineFile(args.file));
	},
	meta: { name: "outline-file", description: "Outline the structure of a file" },
	args: { tsconfig, file: { required: true, type: "positional", description: "Relative file path" } }
});

const imports = defineCommand({
	run({ args }) {
		emit(engineFrom(args).listImports(args.file));
	},
	meta: { name: "imports", description: "List the import statements of a file" },
	args: { tsconfig, file: { required: true, type: "positional", description: "Relative file path" } }
});

const outlineSymbol = defineCommand({
	meta: { name: "outline-symbol", description: "Outline the members of a class/interface" },
	args: { tsconfig, symbol: { required: true, type: "positional", description: "file:name[#index]" } },
	run({ args }) {
		const engine = engineFrom(args);

		emit(engine.outlineSymbol(resolveSymbolOrThrow(engine, args.symbol)));
	}
});

const outlineFn = defineCommand({
	meta: { name: "outline-fn", description: "Outline the statement skeleton of a function" },
	args: {
		tsconfig,
		depth: { type: "string", description: "Nesting depth (default 1)" },
		symbol: { required: true, type: "positional", description: "file:name[#index]" }
	},
	run({ args }) {
		const engine = engineFrom(args);
		const symbol = resolveSymbolOrThrow(engine, args.symbol);

		emit(engine.outlineFunction(symbol, { depth: args.depth ? Number(args.depth) : undefined }));
	}
});

/** Resolve a name to a single symbol, or throw with the candidates / not-found result. */
function resolveSymbolOrThrow(engine: Engine, qualifiedName: string) {
	const result = engine.resolveSymbol(qualifiedName);

	if (result.kind === "symbol") {
		return result.symbol;
	}

	throw new Error(JSON.stringify(result, null, 2));
}

const main = defineCommand({
	meta: { name: "kestrel", description: "Semantic symbol queries for TypeScript" },
	subCommands: {
		def,
		refs,
		impls,
		search,
		imports,
		resolve,
		"outline-fn": outlineFn,
		"outline-file": outlineFile,
		"outline-symbol": outlineSymbol
	}
});

void runMain(main);
