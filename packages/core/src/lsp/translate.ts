/** LSP wire shapes -> kestrel types. Offsets never leave this adapter layer. */
import type { Position } from "../types.js";
import type { LspLocation, LspPosition } from "./protocol.js";

/** `file://<root>/rest` -> `rest`, forward-slashed, root-relative. */
export function uriToRelative(uri: string, root: string): string {
	let path = uri.replace(/^file:\/\//, "").replace(/\\/g, "/");
	// On posix the path keeps its leading slash; decode percent-encoding tsgo may emit.
	path = decodeURIComponent(path);
	const base = root.replace(/\\/g, "/");

	return path.startsWith(base) ? path.slice(base.length).replace(/^\//, "") : path;
}

/** LSP 0-based -> kestrel 1-based. */
export function lspToPosition(pos: LspPosition): { col: number; line: number } {
	return { line: pos.line + 1, col: pos.character + 1 };
}

/** LSP Location -> kestrel Position (relative file + 1-based line/col). */
export function locationToPosition(loc: LspLocation, root: string): Position {
	const { col, line } = lspToPosition(loc.range.start);

	return { col, line, file: uriToRelative(loc.uri, root) };
}
