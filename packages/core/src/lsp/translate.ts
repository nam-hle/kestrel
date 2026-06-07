/** LSP wire shapes -> kestrel types. Offsets never leave this adapter layer. */
import type { Position } from "../types.js";
import type { LspLocation, LspPosition, LocationLink } from "./protocol.js";

/** `file://<root>/rest` -> `rest`, forward-slashed, root-relative. */
export function uriToRelative(uri: string, root: string): string {
	let path = uri.replace(/^file:\/\//, "").replace(/\\/g, "/");
	// Decode percent-encoding tsgo may emit.
	path = decodeURIComponent(path);
	// Windows drive-letter URIs decode to `/C:/...`; drop the leading slash before the drive.
	path = path.replace(/^\/([A-Za-z]:)/, "$1");
	const base = root.replace(/\\/g, "/");

	return path.startsWith(base) ? path.slice(base.length).replace(/^\//, "") : path;
}

/**
 * Normalize an LSP result entry to a plain `Location`, or null when it carries no range.
 * Handles `LocationLink` (targetUri/targetRange — what definition/implementation may return)
 * and the lazy `WorkspaceSymbol` location form (`{ uri }` with no range).
 */
export function asLocationOrNull(value: unknown): LspLocation | null {
	if (value === null || typeof value !== "object") {
		return null;
	}

	const v = value as Partial<LspLocation> & Partial<LocationLink>;

	if (v.targetUri !== undefined && v.targetRange !== undefined) {
		return { uri: v.targetUri, range: v.targetRange };
	}

	if (typeof v.uri === "string" && v.range !== undefined) {
		return { uri: v.uri, range: v.range };
	}

	return null;
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
