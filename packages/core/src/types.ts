/**
 * Core domain types for kestrel. Read-only v1.
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
