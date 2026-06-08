/**
 * Core domain types for symantic. Read-only v1.
 * See docs/DESIGN.md Section 2 (Core API surface).
 */

/** A position in a source file. 1-based line/col, the agent-facing address. */
export interface Position {
	col: number;
	file: string;
	line: number;
}

/** Kind of a reference at a usage site. */
export type ReferenceKind = "call" | "import" | "re-export" | "type-ref" | "read" | "write";

/** One usage of a symbol. Minimal default record. */
export interface Reference {
	/** Whether the reference is in a test file. */
	test?: boolean;
	/**
	 * Surrounding source, present only when `context` was requested:
	 * `snippet` → the reference's own line (trimmed); `block` → the enclosing statement's text.
	 */
	context?: string;
	position: Position;
	kind: ReferenceKind;
}

/** A candidate when a qualified name resolves ambiguously. */
export interface Candidate {
	kind: string;
	position: Position;
	qualifiedName: string;
}

/**
 * Result of resolving a qualified name: either a single symbol handle,
 * or a list of candidates the caller must disambiguate.
 */
export type ResolveResult =
	| { kind: "symbol"; symbol: SymbolHandle }
	| { kind: "ambiguous"; candidates: Candidate[] }
	| { kind: "not-found"; suggestions?: string[] };

/** Opaque handle to a resolved symbol. Shape TBD (wraps ts-morph Symbol). */
export interface SymbolHandle {
	position: Position;
	qualifiedName: string;
}

/** Exact source text of one declaration of a resolved symbol. */
export interface SourceResult {
	/** The declaration's source, from its start to its end (signature + body). */
	source: string;
	position: Position;
	qualifiedName: string;
}

/** A verbatim slice of a file by 1-based inclusive line range. */
export interface RegionResult {
	file: string;
	source: string;
	endLine: number;
	startLine: number;
}

/** A symbol's full local context: source, signature, what it calls, and types it references. */
export interface SymbolContext {
	/** Full declaration source (= symbolSource). */
	source: string;
	/** Declaration head up to the body (single line, whitespace-collapsed). */
	signature: string;
	position: Position;
	/** Distinct named types referenced in the declaration (syntactic, names only). */
	typeRefs: string[];
	/** Symbols this declaration calls (outgoing call hierarchy, depth 1). */
	callees: CallNode[];
	qualifiedName: string;
}

/** Context detail level for query output. */
export type ContextLevel = "none" | "snippet" | "block";

export interface FindUsagesOptions {
	limit?: number;
	cursor?: string;
	context?: ContextLevel;
	/** Omit references located in test files. */
	excludeTests?: boolean;
}

/** Bounded result set with optional continuation cursor. */
export interface UsagesResult {
	total: number;
	nextCursor?: string;
	references: Reference[];
}

/** A member of a class / interface / namespace. */
export interface Member {
	name: string;
	kind: string;
	signature: string;
	position: Position;
	/** Whether the declaration is exported from its file. */
	exported?: boolean;
	/**
	 * Declaration modifiers present on the node, lower-cased: any of `abstract`, `static`,
	 * `readonly`, `async`, `optional`, `default`. `export` is tracked separately via `exported`.
	 */
	modifiers?: string[];
	/** Addressable qualified name (file:Owner.member), when known. */
	qualifiedName?: string;
	/** Generic type parameter names, when the declaration is generic. */
	typeParameters?: string[];
}

/** File-level structural outline ("table of contents"). */
export interface FileOutline {
	exports: Member[];
	classes: Member[];
	functions: Member[];
	/** const/let/var declarations (function-valued consts are also in functions). */
	variables: Member[];
	interfaces: Member[];
}

/** A node in a function-body statement skeleton. */
export interface StatementNode {
	kind: string;
	/** Declared name, when the statement introduces one (function declaration, named const, class). */
	label?: string;
	position: Position;
	children?: StatementNode[];
}

export interface OutlineFunctionOptions {
	depth?: number;
}

/** One row of a usage report: a public symbol with its reference counts. */
export interface UsageReportEntry {
	kind: string;
	/** Total references (post test-exclusion if requested), declaration excluded. */
	total: number;
	/** Non-import, non-re-export references — a proxy for "really consumed". */
	consumed: number;
	position: Position;
	qualifiedName: string;
}

export interface UsageReportOptions {
	excludeTests?: boolean;
}

export interface SearchOptions {
	/** Match the name as a substring (case-insensitive) instead of exact. */
	contains?: boolean;
}

export interface CallHierarchyOptions {
	/** Max levels to walk (default 2). */
	depth?: number;
	/** "incoming" = callers of the symbol (default); "outgoing" = functions it calls. */
	direction?: "incoming" | "outgoing";
}

/** A node in a call hierarchy tree. */
export interface CallNode {
	/** Callers (incoming) or callees (outgoing) one level down. */
	calls: CallNode[];
	position: Position;
	qualifiedName: string;
}

/** One import statement in a file. */
export interface ImportInfo {
	/** Module specifier, e.g. "./shapes.js". */
	module: string;
	/** Named imports (their local names). */
	named: string[];
	/** Default import local name, if any. */
	default?: string;
	/** Namespace import local name (`* as ns`), if any. */
	namespace?: string;
	position: Position;
}
