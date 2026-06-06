/**
 * Core domain types for kestrel. Read-only v1.
 * See docs/DESIGN.md Section 2 (Core API surface).
 */

/** A position in a source file. 1-based line/col, the agent-facing address. */
export interface Position {
  file: string;
  line: number;
  col: number;
}

/** Kind of a reference at a usage site. */
export type ReferenceKind = "call" | "import" | "type-ref" | "read" | "write";

/** One usage of a symbol. Minimal default record. */
export interface Reference {
  position: Position;
  kind: ReferenceKind;
}

/** A candidate when a qualified name resolves ambiguously. */
export interface Candidate {
  qualifiedName: string;
  position: Position;
  kind: string;
}

/**
 * Result of resolving a qualified name: either a single symbol handle,
 * or a list of candidates the caller must disambiguate.
 */
export type ResolveResult =
  | { kind: "symbol"; symbol: SymbolHandle }
  | { kind: "ambiguous"; candidates: Candidate[] }
  | { kind: "not-found" };

/** Opaque handle to a resolved symbol. Shape TBD (wraps ts-morph Symbol). */
export interface SymbolHandle {
  qualifiedName: string;
  position: Position;
}

/** Context detail level for query output. */
export type ContextLevel = "none" | "snippet" | "block";

export interface FindUsagesOptions {
  context?: ContextLevel;
  limit?: number;
  cursor?: string;
}

/** Bounded result set with optional continuation cursor. */
export interface UsagesResult {
  references: Reference[];
  total: number;
  nextCursor?: string;
}

/** A member of a class / interface / namespace. */
export interface Member {
  name: string;
  kind: string;
  signature: string;
  position: Position;
}

/** File-level structural outline ("table of contents"). */
export interface FileOutline {
  exports: Member[];
  classes: Member[];
  interfaces: Member[];
  functions: Member[];
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
