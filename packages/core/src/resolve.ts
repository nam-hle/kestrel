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

/**
 * The namespace/member separator in a qualified name's `name` part: `Model::Inner::Node`.
 * `::` cannot appear unquoted in a TS identifier or module specifier, so a quoted module
 * name (`"@scope.org/pkg.sub"`) keeps its dots intact instead of being split.
 */
export const NS_SEP = "::";

/**
 * Self-help appended to every qualified-name parse error so an agent that passes bad
 * syntax learns the grammar from the error itself, without consulting docs.
 */
const SYNTAX_HINT =
	'syntax: "relativePath:Name", nested with "::" (e.g. "src/a.ts:Outer::Inner", ' +
	'"src/a.ts:MyClass::method"), optional "#n" to disambiguate same-named symbols';

/** Join name segments with the namespace separator. */
export function joinSegments(segments: string[]): string {
	return segments.join(NS_SEP);
}

/** Split a name into its segments on the namespace separator. */
export function splitName(name: string): string[] {
	return name.split(NS_SEP);
}

/**
 * Split `file:name` at the first `:`. The file part is a relative, forward-slashed path
 * with no colon by contract, so the first colon is unambiguously the boundary; the name
 * part keeps any `::` segment separators that follow.
 */
function splitFileAndName(qualifiedName: string): { file: string; name: string } {
	const sep = qualifiedName.indexOf(":");

	if (sep === -1) {
		throw new Error(`invalid qualified name (expected file:name): ${qualifiedName}\n${SYNTAX_HINT}`);
	}

	return { file: qualifiedName.slice(0, sep), name: qualifiedName.slice(sep + 1) };
}

/** Parse `relPath:name`, `relPath:a::b::name`, or any of those with a trailing `#index`. */
export function parseQualifiedName(qualifiedName: string): ParsedName {
	const { file, name } = splitFileAndName(qualifiedName);

	if (file === "") {
		throw new Error(`invalid qualified name (empty file part): ${qualifiedName}\n${SYNTAX_HINT}`);
	}

	let rest = name;
	let index: number | undefined;

	const hash = rest.lastIndexOf("#");

	if (hash !== -1) {
		const parsed = Number(rest.slice(hash + 1));

		if (!Number.isInteger(parsed) || parsed < 0) {
			throw new Error(`invalid index in qualified name: ${qualifiedName}\n${SYNTAX_HINT}`);
		}

		index = parsed;
		rest = rest.slice(0, hash);
	}

	if (rest === "") {
		throw new Error(`invalid qualified name (empty name part): ${qualifiedName}\n${SYNTAX_HINT}`);
	}

	const segments = splitName(rest);

	if (segments.some((s) => s === "")) {
		throw new Error(`invalid qualified name (empty segment): ${qualifiedName}\n${SYNTAX_HINT}`);
	}

	return { file, index, segments };
}

/** Named declarations directly under a node (top-level statements or namespace body). */
function childDeclarations(statements: Statement[]): NamedDeclaration[] {
	const decls: NamedDeclaration[] = [];

	for (const stmt of statements) {
		if (Node.isVariableStatement(stmt)) {
			for (const decl of stmt.getDeclarations()) {
				// Skip destructuring patterns (`const { a, b } = ...`) — no addressable name.
				if (!Node.isIdentifier(decl.getNameNode())) {
					continue;
				}

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

/** Statements inside a namespace, function, method, or arrow/fn-expr body, if any. */
function bodyStatements(node: Node): Statement[] {
	if (Node.isModuleDeclaration(node)) {
		const body = node.getBody();

		return body !== undefined && Node.isModuleBlock(body) ? body.getStatements() : [];
	}

	// Nested declarations inside a function/method body (e.g. a factory's inner functions).
	let body: Node | undefined;

	if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
		body = node.getBody();
	} else if (Node.isVariableDeclaration(node)) {
		const init = node.getInitializer();

		if (init !== undefined && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
			body = init.getBody();
		}
	}

	return body !== undefined && Node.isBlock(body) ? body.getStatements() : [];
}

/** Named members of a class or interface declaration, as child declarations. */
function memberDeclarations(node: Node): NamedDeclaration[] {
	if (!Node.isClassDeclaration(node) && !Node.isInterfaceDeclaration(node)) {
		return [];
	}

	const members: NamedDeclaration[] = [];

	for (const member of node.getMembers()) {
		if (Node.hasName(member)) {
			const name = member.getName();

			if (name !== undefined) {
				members.push({ path: name, node: member });
			}
		}
	}

	return members;
}

/**
 * Function/arrow-valued properties of object literals inside a declaration's body
 * (e.g. a factory `return { mean: () => ... }`). Lets object-literal selectors be
 * addressed and traced. Scoped to function/arrow-valued properties only.
 */
function objectLiteralFunctionProps(node: Node): NamedDeclaration[] {
	const props: NamedDeclaration[] = [];

	node.forEachDescendant((descendant) => {
		// Shorthand method in an object literal: `{ greet(name) { ... } }`.
		if (Node.isMethodDeclaration(descendant) && Node.isObjectLiteralExpression(descendant.getParent())) {
			const name = descendant.getName();

			if (name !== "") {
				props.push({ path: name, node: descendant });
			}

			return;
		}

		if (!Node.isPropertyAssignment(descendant)) {
			return;
		}

		const init = descendant.getInitializer();

		if (init !== undefined && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
			const name = descendant.getName();

			if (name !== "") {
				props.push({ path: name, node: descendant });
			}
		}
	});

	return props;
}

/** All named declarations in a file, recursing into namespaces + class/interface members. */
export function allDeclarations(sourceFile: SourceFile): NamedDeclaration[] {
	const result: NamedDeclaration[] = [];

	const descend = (node: Node, fullPath: string): void => {
		for (const { path, node: child } of [...childDeclarations(bodyStatements(node)), ...memberDeclarations(node)]) {
			const childPath = joinSegments([fullPath, path]);
			result.push({ node: child, path: childPath });
			descend(child, childPath);
		}

		// Object-literal selector/handler properties (e.g. factory `return { mean: () => ... }`).
		for (const { path, node: prop } of objectLiteralFunctionProps(node)) {
			result.push({ node: prop, path: joinSegments([fullPath, path]) });
		}
	};

	for (const { node, path } of childDeclarations(sourceFile.getStatements())) {
		result.push({ node, path });
		descend(node, path);
	}

	return result;
}

/** Statements inside a namespace/module body only (not function/method bodies). */
function namespaceBodyStatements(node: Node): Statement[] {
	if (!Node.isModuleDeclaration(node)) {
		return [];
	}

	const body = node.getBody();

	return body !== undefined && Node.isModuleBlock(body) ? body.getStatements() : [];
}

/**
 * Declarations for a file *outline*: top-level + namespace recursion + class/interface
 * members. Unlike allDeclarations it does NOT descend into function bodies or object
 * literals — an outline is structure, not local variables.
 */
export function outlineDeclarations(sourceFile: SourceFile): NamedDeclaration[] {
	const result: NamedDeclaration[] = [];

	const descend = (node: Node, fullPath: string): void => {
		for (const { path, node: child } of [...childDeclarations(namespaceBodyStatements(node)), ...memberDeclarations(node)]) {
			const childPath = joinSegments([fullPath, path]);
			result.push({ node: child, path: childPath });
			descend(child, childPath);
		}
	};

	for (const { node, path } of childDeclarations(sourceFile.getStatements())) {
		result.push({ node, path });
		descend(node, path);
	}

	return result;
}

/**
 * Find declarations matching a name path. A multi-segment path matches by exact
 * dotted path; a single segment matches the last path component at any depth.
 */
export function findNamedDeclarations(sourceFile: SourceFile, segments: string[]): NamedDeclaration[] {
	const all = allDeclarations(sourceFile);

	if (segments.length > 1) {
		const target = joinSegments(segments);

		return all.filter((d) => d.path === target);
	}

	const name = segments[0];

	return all.filter((d) => {
		const parts = splitName(d.path);

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

/** Levenshtein edit distance between two strings. */
function editDistance(a: string, b: string): number {
	const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);

	for (let j = 1; j <= b.length; j++) {
		rows[0]![j] = j;
	}

	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
		}
	}

	return rows[a.length]![b.length]!;
}

/** Nearest declaration names in a file to a (mistyped) target — for not-found suggestions. */
export function nearestNames(sourceFile: SourceFile, target: string, limit = 3): string[] {
	const names = [
		...new Set(
			allDeclarations(sourceFile).map((d) => {
				const parts = splitName(d.path);

				return parts[parts.length - 1]!;
			})
		)
	];
	const threshold = Math.max(2, Math.ceil(target.length / 3));

	return names
		.map((name) => ({ name, dist: editDistance(name.toLowerCase(), target.toLowerCase()) }))
		.filter((c) => c.dist > 0 && c.dist <= threshold)
		.sort((a, b) => a.dist - b.dist)
		.slice(0, limit)
		.map((c) => c.name);
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
