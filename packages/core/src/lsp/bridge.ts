/**
 * The addressing bridge: resolve a kestrel dotted name against a tsgo `documentSymbol`
 * tree to LSP positions. No second semantic engine — tsgo is the single source of truth
 * for "where is this symbol".
 */
import type { LspPosition, LspSymbolKind, DocumentSymbol } from "./protocol.js";

export interface SymbolHit {
	name: string;
	/** Dotted path from a root symbol, e.g. "Circle.area". */
	path: string;
	kind: LspSymbolKind;
	/** selectionRange.start — points at the name token, the position to send to LSP. */
	position: LspPosition;
	/** range.start — points at the declaration start (matches ts-morph `node.getStart()`). */
	rangeStart: LspPosition;
}

/** Flatten the tree to (path, hit) pairs, depth-first. */
function flatten(symbols: DocumentSymbol[], prefix: string): SymbolHit[] {
	const out: SymbolHit[] = [];

	for (const sym of symbols) {
		const path = prefix === "" ? sym.name : `${prefix}.${sym.name}`;
		out.push({ path, name: sym.name, kind: sym.kind, rangeStart: sym.range.start, position: sym.selectionRange.start });

		if (sym.children !== undefined && sym.children.length > 0) {
			out.push(...flatten(sym.children, path));
		}
	}

	return out;
}

/**
 * A multi-segment path matches by exact dotted path; a single bare segment matches the
 * last path component at any depth. Returns every match (caller disambiguates by #index).
 */
export function resolveInSymbols(symbols: DocumentSymbol[], segments: string[]): SymbolHit[] {
	const all = flatten(symbols, "");

	if (segments.length > 1) {
		const target = segments.join(".");

		return all.filter((h) => h.path === target);
	}

	const name = segments[0]!;

	return all.filter((h) => {
		const parts = h.path.split(".");

		return parts[parts.length - 1] === name;
	});
}
