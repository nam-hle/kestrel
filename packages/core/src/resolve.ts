/**
 * Symbol resolution — qualified-name parsing and name-based declaration lookup.
 *
 * Grammar: `relPath:name` where `name` is a dot-separated path into nested
 * namespaces (`Model.Inner.Node`), with an optional `#index` to disambiguate.
 * A bare last segment (`Node`) matches a declaration at any namespace depth and
 * returns each match tagged with its full dotted path.
 * See docs/DESIGN.md open-Q (symbol resolution).
 */
import { Node } from "ts-morph";
import type { Statement, SourceFile } from "ts-morph";

import type { Position, SymbolHandle } from "./types.js";

export interface ParsedName {
	file: string;
	/** Zero-based index into same-name declarations, when disambiguated (`name#1`). */
	index?: number;
	/** Dot-separated segments of the symbol path, e.g. ["Model", "Node"]. */
	segments: string[];
}

/** A declaration with its full dotted path within the file. */
export interface NamedDeclaration {
	node: Node;
	/** Dotted name, e.g. "Model.Inner.Node". */
	path: string;
}

/** Parse `relPath:name`, `relPath:a.b.name`, or any of those with a trailing `#index`. */
export function parseQualifiedName(qualifiedName: string): ParsedName {
	const sep = qualifiedName.lastIndexOf(":");

	if (sep === -1) {
		throw new Error(`invalid qualified name (expected file:name): ${qualifiedName}`);
	}

	const file = qualifiedName.slice(0, sep);
	let rest = qualifiedName.slice(sep + 1);
	let index: number | undefined;

	const hash = rest.lastIndexOf("#");

	if (hash !== -1) {
		const parsed = Number(rest.slice(hash + 1));

		if (!Number.isInteger(parsed) || parsed < 0) {
			throw new Error(`invalid index in qualified name: ${qualifiedName}`);
		}

		index = parsed;
		rest = rest.slice(0, hash);
	}

	return { file, index, segments: rest.split(".") };
}

/** Named declarations directly under a node (top-level statements or namespace body). */
function childDeclarations(statements: Statement[]): NamedDeclaration[] {
	const decls: NamedDeclaration[] = [];

	for (const stmt of statements) {
		if (Node.isVariableStatement(stmt)) {
			for (const decl of stmt.getDeclarations()) {
				decls.push({ node: decl, path: decl.getName() });
			}
		} else if (Node.hasName(stmt)) {
			const name = stmt.getName();

			if (name !== undefined) {
				decls.push({ node: stmt, path: name });
			}
		}
	}

	return decls;
}

/** Statements inside a namespace/module declaration body, if any. */
function bodyStatements(node: Node): Statement[] {
	if (!Node.isModuleDeclaration(node)) {
		return [];
	}

	const body = node.getBody();

	return body !== undefined && Node.isModuleBlock(body) ? body.getStatements() : [];
}

/** All named declarations in a file, recursing into namespaces, each with its dotted path. */
export function allDeclarations(sourceFile: SourceFile): NamedDeclaration[] {
	const result: NamedDeclaration[] = [];

	const walk = (statements: Statement[], prefix: string): void => {
		for (const { node, path } of childDeclarations(statements)) {
			const fullPath = prefix === "" ? path : `${prefix}.${path}`;
			result.push({ node, path: fullPath });
			walk(bodyStatements(node), fullPath);
		}
	};

	walk(sourceFile.getStatements(), "");

	return result;
}

/**
 * Find declarations matching a name path. A multi-segment path matches by exact
 * dotted path; a single segment matches the last path component at any depth.
 */
export function findNamedDeclarations(sourceFile: SourceFile, segments: string[]): NamedDeclaration[] {
	const all = allDeclarations(sourceFile);

	if (segments.length > 1) {
		const target = segments.join(".");

		return all.filter((d) => d.path === target);
	}

	const name = segments[0];

	return all.filter((d) => {
		const parts = d.path.split(".");

		return parts[parts.length - 1] === name;
	});
}

/**
 * Like findNamedDeclarations, but if a single-segment name isn't declared locally,
 * follow the file's `export … from` / `export *` re-exports to the true declaration(s).
 * Dotted (namespace) paths are resolved locally only.
 */
export function findDeclarationsThroughReExports(sourceFile: SourceFile, segments: string[], seen: Set<string> = new Set()): NamedDeclaration[] {
	const local = findNamedDeclarations(sourceFile, segments);

	if (local.length > 0 || segments.length > 1) {
		return local;
	}

	const filePath = sourceFile.getFilePath();

	if (seen.has(filePath)) {
		return [];
	}

	seen.add(filePath);
	const name = segments[0]!;

	for (const exportDecl of sourceFile.getExportDeclarations()) {
		const target = exportDecl.getModuleSpecifierSourceFile();

		if (target === undefined) {
			continue;
		}

		const named = exportDecl.getNamedExports();

		// `export { a, b as c } from`: only follow if this export forwards our name.
		if (named.length > 0) {
			const forwards = named.some((spec) => (spec.getAliasNode()?.getText() ?? spec.getName()) === name);

			if (!forwards) {
				continue;
			}
		}

		const found = findDeclarationsThroughReExports(target, [name], seen);

		if (found.length > 0) {
			return found;
		}
	}

	return [];
}

/** Make an absolute file path relative to a base dir, normalized to forward slashes. */
export function toRelative(absPath: string, baseDir: string): string {
	const normalized = absPath.replace(/\\/g, "/");
	const base = baseDir.replace(/\\/g, "/");

	return normalized.startsWith(base) ? normalized.slice(base.length).replace(/^\//, "") : normalized;
}

export function position(node: Node, baseDir: string): Position {
	const start = node.getStart();
	const sourceFile = node.getSourceFile();
	const { line, column } = sourceFile.getLineAndColumnAtPos(start);

	return { line, col: column, file: toRelative(sourceFile.getFilePath(), baseDir) };
}

/** Build a SymbolHandle for a declaration, optionally with a disambiguation index. */
export function declarationToHandle(decl: NamedDeclaration, file: string, baseDir: string, index?: number): SymbolHandle {
	const qualifiedName = index === undefined ? `${file}:${decl.path}` : `${file}:${decl.path}#${index}`;

	return { qualifiedName, position: position(decl.node, baseDir) };
}
