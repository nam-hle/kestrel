import { LspSymbolKind } from "./protocol.js";
/**
 * The addressing bridge: resolve a kestrel dotted name against a tsgo `documentSymbol`
 * tree to LSP positions. No second semantic engine — tsgo is the single source of truth
 * for "where is this symbol".
 */
import { NS_SEP, splitName, joinSegments } from "../resolve.js";
import type { LspPosition, DocumentSymbol } from "./protocol.js";

export interface SymbolHit {
	name: string;
	/** Dotted path from a root symbol, e.g. "Circle.area". */
	path: string;
	/** True when an ancestor is a body container (see BODY_KINDS) — i.e. a body-local. */
	inBody: boolean;
	kind: LspSymbolKind;
	/** selectionRange.start — points at the name token, the position to send to LSP. */
	position: LspPosition;
	/** range.start — points at the declaration start (matches ts-morph `node.getStart()`). */
	rangeStart: LspPosition;
}

/**
 * Kinds whose children are body-locals, not addressable declarations. Mirrors the ts-morph
 * resolver, which descends into namespaces + class/interface members only — never into
 * function bodies or variable initializers (arrow bodies, object literals).
 */
const BODY_KINDS = new Set<LspSymbolKind>([
	LspSymbolKind.Function,
	LspSymbolKind.Method,
	LspSymbolKind.Constructor,
	LspSymbolKind.Variable,
	LspSymbolKind.Constant
]);

/** Flatten the tree to (path, hit) pairs, depth-first. */
function flatten(symbols: DocumentSymbol[], prefix: string, inBody: boolean): SymbolHit[] {
	const out: SymbolHit[] = [];

	for (const sym of symbols) {
		const path = prefix === "" ? sym.name : `${prefix}${NS_SEP}${sym.name}`;
		out.push({ path, inBody, name: sym.name, kind: sym.kind, rangeStart: sym.range.start, position: sym.selectionRange.start });

		if (sym.children !== undefined && sym.children.length > 0) {
			out.push(...flatten(sym.children, path, inBody || BODY_KINDS.has(sym.kind)));
		}
	}

	return out;
}

/**
 * A multi-segment path matches by exact dotted path; a single bare segment matches the
 * last path component at any depth. Returns every match (caller disambiguates by #index).
 */
export function resolveInSymbols(symbols: DocumentSymbol[], segments: string[]): SymbolHit[] {
	// Exclude function/method body locals: ts-morph's resolver matches top-level + namespace +
	// type members, never body-locals. tsgo's documentSymbol descends into bodies, so a bare
	// name would otherwise collide a top-level decl with a same-named local (false ambiguous).
	const all = flatten(symbols, "", false).filter((h) => !h.inBody);

	if (segments.length > 1) {
		const target = joinSegments(segments);

		return all.filter((h) => h.path === target);
	}

	const name = segments[0]!;

	return all.filter((h) => {
		const parts = splitName(h.path);

		return parts[parts.length - 1] === name;
	});
}
