/** Minimal subset of the LSP types kestrel's LspEngine uses. 0-based line/character. */

export interface LspPosition {
	line: number;
	character: number;
}

export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

export interface LspLocation {
	uri: string;
	range: LspRange;
}

/** LSP SymbolKind subset we map to kestrel kind names. */
export enum LspSymbolKind {
	File = 1,
	Module = 2,
	Namespace = 3,
	Class = 5,
	Method = 6,
	Property = 7,
	Constructor = 9,
	Interface = 11,
	Function = 12,
	Variable = 13,
	Constant = 14,
	TypeParameter = 26,
}

/** Hierarchical document symbol (tsgo returns this nested form). */
export interface DocumentSymbol {
	name: string;
	kind: LspSymbolKind;
	range: LspRange;
	selectionRange: LspRange;
	children?: DocumentSymbol[];
}

export interface CallHierarchyItem {
	name: string;
	kind: LspSymbolKind;
	uri: string;
	range: LspRange;
	selectionRange: LspRange;
}

export interface CallHierarchyIncomingCall {
	from: CallHierarchyItem;
	fromRanges: LspRange[];
}

export interface CallHierarchyOutgoingCall {
	to: CallHierarchyItem;
	fromRanges: LspRange[];
}
