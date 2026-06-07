/**
 * The read-only query surface kestrel exposes. Implemented by the ts-morph `Engine`
 * (default) and the tsgo `LspEngine` (opt-in). Transport-agnostic; output uses kestrel's
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
	ResolveResult,
	SearchOptions,
	StatementNode,
	UsageReportEntry,
	FindUsagesOptions,
	UsageReportOptions,
	CallHierarchyOptions,
	OutlineFunctionOptions
} from "./types.js";

export interface SymbolEngine {
	refreshIfStale(): void;
	outlineFile(path: string): FileOutline;
	listImports(path: string): ImportInfo[];
	publicSurface(path: string): Candidate[];
	outlineSymbol(symbol: SymbolHandle): Member[];
	resolveSymbol(qualifiedName: string): ResolveResult;
	findDefinition(symbol: SymbolHandle): SymbolHandle[];
	findImplementations(symbol: SymbolHandle): SymbolHandle[];
	searchSymbol(name: string, options?: SearchOptions): Candidate[];
	findUsages(symbol: SymbolHandle, options?: FindUsagesOptions): UsagesResult;
	usageReport(path: string, options?: UsageReportOptions): UsageReportEntry[];
	callHierarchy(symbol: SymbolHandle, options?: CallHierarchyOptions): CallNode[];
	outlineFunction(symbol: SymbolHandle, options?: OutlineFunctionOptions): StatementNode[];
}
