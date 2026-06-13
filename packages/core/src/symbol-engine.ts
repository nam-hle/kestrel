/**
 * The read-only query surface symantic exposes. Implemented by the ts-morph `Engine`
 * (default) and the tsgo `LspEngine` (opt-in). Transport-agnostic; output uses symantic's
 * name-addressed contract (file:Name + 1-based Position), never byte/LSP offsets.
 */
import type {
	Member,
	CallNode,
	Candidate,
	ImportInfo,
	FileOutline,
	SymbolHandle,
	UsagesResult,
	SourceResult,
	RegionResult,
	ResolveResult,
	SearchOptions,
	StatementNode,
	SymbolContext,
	UsageReportEntry,
	FindUsagesOptions,
	UsageReportOptions,
	CallHierarchyOptions,
	OutlineFunctionOptions
} from "./types.js";

export interface SymbolEngine {
	refreshIfStale(): void;
	/** Number of source files in the loaded project — 0 signals a non-loadable (base) tsconfig. */
	sourceFileCount(): number;
	outlineFile(path: string): FileOutline;
	listImports(path: string): ImportInfo[];
	publicSurface(path: string): Candidate[];
	outlineSymbol(symbol: SymbolHandle): Member[];
	/** Members of a name, folding a declaration merge (interface+namespace) into one list. */
	membersByName(qualifiedName: string): Member[];
	symbolSource(symbol: SymbolHandle): SourceResult[];
	symbolContext(symbol: SymbolHandle): SymbolContext;
	resolveSymbol(qualifiedName: string): ResolveResult;
	findDefinition(symbol: SymbolHandle): SymbolHandle[];
	findImplementations(symbol: SymbolHandle): SymbolHandle[];
	searchSymbol(name: string, options?: SearchOptions): Candidate[];
	readRegion(file: string, startLine: number, endLine: number): RegionResult;
	findUsages(symbol: SymbolHandle, options?: FindUsagesOptions): UsagesResult;
	usageReport(path: string, options?: UsageReportOptions): UsageReportEntry[];
	callHierarchy(symbol: SymbolHandle, options?: CallHierarchyOptions): CallNode[];
	outlineFunction(symbol: SymbolHandle, options?: OutlineFunctionOptions): StatementNode[];
}

/**
 * Async form of SymbolEngine — every method returns a Promise, plus `dispose` for engines
 * that own resources (the tsgo subprocess). This is the single surface CLI + MCP consume, so
 * either engine works through one `await`-everything code path.
 */
export type AsyncSymbolEngine = {
	[K in keyof SymbolEngine]: (...args: Parameters<SymbolEngine[K]>) => Promise<ReturnType<SymbolEngine[K]>>;
} & {
	/** Release any held resources (subprocess, warm project). No-op for the ts-morph engine. */
	dispose(): Promise<void>;
};
