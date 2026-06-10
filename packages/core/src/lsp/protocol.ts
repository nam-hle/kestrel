/** Minimal subset of the LSP types symantic's LspEngine uses. 0-based line/character. */

export interface LspPosition {
	line: number;
	character: number;
}

export interface LspRange {
	end: LspPosition;
	start: LspPosition;
}

export interface LspLocation {
	uri: string;
	range: LspRange;
}

/** Alternative result of definition/implementation requests (LSP `LocationLink`). */
export interface LocationLink {
	targetUri: string;
	targetRange: LspRange;
	targetSelectionRange: LspRange;
	originSelectionRange?: LspRange;
}

/** LSP SymbolKind subset we map to symantic kind names. */
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
	TypeParameter = 26
}

/**
 * Map an LSP `SymbolKind` (from `workspace/symbol`) to the ts-morph `getKindName()` string the
 * renderer's KIND_SHORT table compacts — so the lsp engine reports the same kind as ts-morph.
 * Falls back to "unknown" for kinds we don't model (the renderer prints those verbatim).
 */
export function lspSymbolKindToName(kind: LspSymbolKind | number): string {
	switch (kind) {
		case LspSymbolKind.Class:
			return "ClassDeclaration";
		case LspSymbolKind.Interface:
			return "InterfaceDeclaration";
		case LspSymbolKind.Function:
			return "FunctionDeclaration";
		case LspSymbolKind.Method:
			return "MethodDeclaration";
		case LspSymbolKind.Property:
			return "PropertyDeclaration";
		case LspSymbolKind.Namespace:
		case LspSymbolKind.Module:
			return "ModuleDeclaration";
		case LspSymbolKind.Variable:
		case LspSymbolKind.Constant:
			return "VariableDeclaration";
		case LspSymbolKind.TypeParameter:
			return "TypeParameter";
		default:
			return "unknown";
	}
}

/** Hierarchical document symbol (tsgo returns this nested form). */
export interface DocumentSymbol {
	name: string;
	range: LspRange;
	kind: LspSymbolKind;
	selectionRange: LspRange;
	children?: DocumentSymbol[];
}

export interface CallHierarchyItem {
	uri: string;
	name: string;
	range: LspRange;
	kind: LspSymbolKind;
	selectionRange: LspRange;
}

export interface CallHierarchyIncomingCall {
	fromRanges: LspRange[];
	from: CallHierarchyItem;
}

export interface CallHierarchyOutgoingCall {
	to: CallHierarchyItem;
	fromRanges: LspRange[];
}
