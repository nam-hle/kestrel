/**
 * Engine selection + the sync→async bridge. CLI and MCP consume an `AsyncSymbolEngine` so a
 * single `await`-everything code path works for either backend: the sync ts-morph `Engine`
 * (default) wrapped here, or the natively-async tsgo `LspEngine`.
 */
import { Engine } from "./engine.js";
import { LspEngine } from "./lsp-engine.js";
import type { SymbolEngine, AsyncSymbolEngine } from "./symbol-engine.js";

export type EngineKind = "tsmorph" | "lsp";

export interface CreateEngineOptions {
	/** Which backend to use. Defaults to the ts-morph engine. */
	engine?: EngineKind;
	tsConfigPath: string;
}

/** Wrap a synchronous SymbolEngine as an AsyncSymbolEngine (results resolved immediately). */
export function asAsync(engine: SymbolEngine): AsyncSymbolEngine {
	return {
		dispose: () => Promise.resolve(),
		refreshIfStale: () => Promise.resolve(engine.refreshIfStale()),
		outlineFile: (path) => Promise.resolve(engine.outlineFile(path)),
		listImports: (path) => Promise.resolve(engine.listImports(path)),
		publicSurface: (path) => Promise.resolve(engine.publicSurface(path)),
		symbolSource: (symbol) => Promise.resolve(engine.symbolSource(symbol)),
		outlineSymbol: (symbol) => Promise.resolve(engine.outlineSymbol(symbol)),
		symbolContext: (symbol) => Promise.resolve(engine.symbolContext(symbol)),
		findDefinition: (symbol) => Promise.resolve(engine.findDefinition(symbol)),
		usageReport: (path, options) => Promise.resolve(engine.usageReport(path, options)),
		searchSymbol: (name, options) => Promise.resolve(engine.searchSymbol(name, options)),
		findUsages: (symbol, options) => Promise.resolve(engine.findUsages(symbol, options)),
		findImplementations: (symbol) => Promise.resolve(engine.findImplementations(symbol)),
		membersByName: (qualifiedName) => Promise.resolve(engine.membersByName(qualifiedName)),
		resolveSymbol: (qualifiedName) => Promise.resolve(engine.resolveSymbol(qualifiedName)),
		callHierarchy: (symbol, options) => Promise.resolve(engine.callHierarchy(symbol, options)),
		outlineFunction: (symbol, options) => Promise.resolve(engine.outlineFunction(symbol, options)),
		readRegion: (file, startLine, endLine) => Promise.resolve(engine.readRegion(file, startLine, endLine))
	};
}

/** Create the selected engine as an AsyncSymbolEngine. ts-morph is the default. */
export function createEngine(options: CreateEngineOptions): AsyncSymbolEngine {
	const kind = options.engine ?? "tsmorph";

	if (kind === "tsmorph") {
		return asAsync(new Engine({ tsConfigPath: options.tsConfigPath }));
	}

	if (kind === "lsp") {
		return new LspEngine({ tsConfigPath: options.tsConfigPath });
	}

	throw new Error(`unknown engine: ${String(kind)} (expected "tsmorph" or "lsp")`);
}
