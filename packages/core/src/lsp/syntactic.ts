/**
 * Syntactic ops via the typescript native API — for what tsgo's LSP cannot serve
 * (imports, outline detail, function bodies, reference-kind classification). Parses a
 * single file; no project, no typecheck.
 */
import ts from "typescript";

import { NS_SEP } from "../resolve.js";
import type { LspPosition } from "./protocol.js";
import type { Member, ImportInfo, FileOutline, ReferenceKind, StatementNode } from "../types.js";

function parse(path: string, text: string): ts.SourceFile {
	return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TS);
}

/** 0-based ts position -> kestrel 1-based. */
function posOf(sf: ts.SourceFile, pos: number): { col: number; line: number } {
	const { line, character } = sf.getLineAndCharacterOfPosition(pos);

	return { line: line + 1, col: character + 1 };
}

export function parseImports(path: string, text: string): ImportInfo[] {
	const sf = parse(path, text);
	const imports: ImportInfo[] = [];

	for (const stmt of sf.statements) {
		if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) {
			continue;
		}

		const named: string[] = [];
		let defaultImport: string | undefined;
		let namespace: string | undefined;
		const clause = stmt.importClause;

		if (clause?.name !== undefined) {
			defaultImport = clause.name.text;
		}

		const bindings = clause?.namedBindings;

		if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
			namespace = bindings.name.text;
		} else if (bindings !== undefined && ts.isNamedImports(bindings)) {
			for (const el of bindings.elements) {
				named.push(el.name.text);
			}
		}

		const { col, line } = posOf(sf, stmt.getStart(sf));

		imports.push({
			named,
			module: stmt.moduleSpecifier.text,
			...(defaultImport !== undefined ? { default: defaultImport } : {}),
			...(namespace !== undefined ? { namespace } : {}),
			position: { col, line, file: path }
		});
	}

	return imports;
}

/** A re-export the file forwards from another module. */
export interface ReExport {
	/** Exported name (alias when `export { a as b }`), or undefined for `export *`. */
	name?: string;
	/** Whether this is `export * from` (forwards the module's whole surface). */
	star: boolean;
	/** Module specifier, e.g. "./shapes.js". */
	module: string;
}

/** Re-exports of a file: `export { X } from`, `export { a as b } from`, `export * from`. */
export function parseReExports(path: string, text: string): ReExport[] {
	const sf = parse(path, text);
	const out: ReExport[] = [];

	for (const stmt of sf.statements) {
		if (!ts.isExportDeclaration(stmt) || stmt.moduleSpecifier === undefined || !ts.isStringLiteral(stmt.moduleSpecifier)) {
			continue;
		}

		const module = stmt.moduleSpecifier.text;

		if (stmt.exportClause === undefined) {
			out.push({ module, star: true });
		} else if (ts.isNamedExports(stmt.exportClause)) {
			for (const el of stmt.exportClause.elements) {
				out.push({ module, star: false, name: el.name.text });
			}
		}
	}

	return out;
}

/**
 * Surrounding source at an LSP (0-based) position, at the requested level:
 * `snippet` → that line, trimmed; `block` → the enclosing statement's text
 * (whitespace-collapsed), falling back to the snippet.
 */
export function contextAt(text: string, pos: LspPosition, level: "snippet" | "block"): string {
	const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
	const snippet = (lines[pos.line] ?? "").trim();

	if (level === "snippet") {
		return snippet;
	}

	const sf = parse("__ctx.ts", text);
	const offset = sf.getPositionOfLineAndCharacter(pos.line, pos.character);
	let statement: ts.Node | undefined;

	const visit = (node: ts.Node): void => {
		if (offset < node.getStart(sf) || offset >= node.getEnd()) {
			return;
		}

		if (ts.isStatement(node)) {
			statement = node;
		}

		node.forEachChild(visit);
	};

	visit(sf);

	return statement !== undefined ? statement.getText(sf).replace(/\s+/g, " ") : snippet;
}

/** Find the identifier node at an LSP (0-based) position and classify its reference kind. */
export function classifyAt(text: string, pos: LspPosition): ReferenceKind {
	const sf = parse("__classify.ts", text);
	const offset = sf.getPositionOfLineAndCharacter(pos.line, pos.character);
	const node = nodeAt(sf, offset);

	return node === undefined ? "read" : classify(node);
}

function nodeAt(sf: ts.SourceFile, offset: number): ts.Node | undefined {
	let found: ts.Node | undefined;

	const visit = (node: ts.Node): void => {
		if (offset < node.getStart(sf) || offset >= node.getEnd()) {
			return;
		}

		if (ts.isIdentifier(node)) {
			found = node;
		}

		node.forEachChild(visit);
	};

	visit(sf);

	return found;
}

function classify(node: ts.Node): ReferenceKind {
	for (let n: ts.Node | undefined = node; n !== undefined; n = n.parent) {
		if (ts.isExportSpecifier(n)) {
			const decl = n.parent.parent;

			if (ts.isExportDeclaration(decl) && decl.moduleSpecifier !== undefined) {
				return "re-export";
			}
		}

		if (ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n)) {
			return "import";
		}

		if (ts.isTypeReferenceNode(n) || ts.isTypeQueryNode(n)) {
			return "type-ref";
		}
	}

	// Call target: identifier (or its property-access) is the callee of a call/new.
	let target: ts.Node = node;

	if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
		target = node.parent;
	}

	const parent = target.parent;

	if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === target) {
		return "call";
	}

	if (ts.isBinaryExpression(node.parent) && node.parent.left === node && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
		return "write";
	}

	return "read";
}

function typeParamsOf(node: ts.Node): string[] | undefined {
	if (!ts.isClassDeclaration(node) && !ts.isInterfaceDeclaration(node) && !ts.isFunctionDeclaration(node) && !ts.isTypeAliasDeclaration(node)) {
		return undefined;
	}

	const tps = node.typeParameters;

	return tps !== undefined && tps.length > 0 ? tps.map((tp) => tp.name.text) : undefined;
}

function isExported(node: ts.Node): boolean {
	const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;

	return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

interface MemberArgs {
	kind: string;
	name: string;
	path: string;
	node: ts.Node;
	sf: ts.SourceFile;
	/** Override for the addressable qualifiedName (defaults to `path:name`). */
	qualified?: string;
}

function memberOf({ sf, kind, name, node, path, qualified }: MemberArgs): Member {
	const { col, line } = posOf(sf, node.getStart(sf));
	const tps = typeParamsOf(node);

	return {
		name,
		kind,
		signature: name,
		exported: isExported(node),
		position: { col, line, file: path },
		qualifiedName: qualified ?? `${path}:${name}`,
		...(tps !== undefined ? { typeParameters: tps } : {})
	};
}

export function buildOutline(path: string, text: string): FileOutline {
	const sf = parse(path, text);
	const outline: FileOutline = { classes: [], exports: [], functions: [], variables: [], interfaces: [] };
	walkOutline({ sf, path, outline }, sf.statements, "");

	return outline;
}

/**
 * Top-level EXPORTED declarations only (class/interface/function/type-alias/namespace/var) —
 * NOT namespace members. This is the public *surface* of a file's own code, mirroring
 * ts-morph's getExportedDeclarations: an exported namespace counts as one entry, not its
 * members. (outlineFile, by contrast, recurses into members.)
 */
export function topLevelExports(path: string, text: string): Member[] {
	const sf = parse(path, text);
	const out: Member[] = [];

	const push = (name: string, kind: string, node: ts.Node): void => {
		out.push(memberOf({ sf, path, name, kind, node }));
	};

	for (const stmt of sf.statements) {
		if (!isExported(stmt)) {
			continue;
		}

		if (ts.isClassDeclaration(stmt) && stmt.name !== undefined) {
			push(stmt.name.text, "ClassDeclaration", stmt);
		} else if (ts.isInterfaceDeclaration(stmt)) {
			push(stmt.name.text, "InterfaceDeclaration", stmt);
		} else if (ts.isFunctionDeclaration(stmt) && stmt.name !== undefined) {
			push(stmt.name.text, "FunctionDeclaration", stmt);
		} else if (ts.isTypeAliasDeclaration(stmt)) {
			push(stmt.name.text, "TypeAliasDeclaration", stmt);
		} else if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
			push(stmt.name.text, "ModuleDeclaration", stmt);
		} else if (ts.isVariableStatement(stmt)) {
			for (const decl of stmt.declarationList.declarations) {
				if (ts.isIdentifier(decl.name)) {
					push(decl.name.text, "VariableDeclaration", stmt);
				}
			}
		}
	}

	return out;
}

/** Invariants threaded through the outline walk. */
interface OutlineWalk {
	path: string;
	sf: ts.SourceFile;
	outline: FileOutline;
}

/** Statements inside a namespace/module body, if it has a block body. */
function moduleStatements(node: ts.ModuleDeclaration): readonly ts.Statement[] {
	return node.body !== undefined && ts.isModuleBlock(node.body) ? node.body.statements : [];
}

/**
 * Classify each statement into the outline buckets, recursing into namespaces so members get
 * a dotted path (`Events.onClick`) — mirrors the ts-morph engine's outlineDeclarations.
 */
function walkOutline(walk: OutlineWalk, statements: readonly ts.Statement[], prefix: string): void {
	const { sf, path, outline } = walk;
	const dotted = (name: string): string => (prefix === "" ? name : `${prefix}${NS_SEP}${name}`);

	for (const stmt of statements) {
		let member: Member | undefined;

		if (ts.isClassDeclaration(stmt) && stmt.name !== undefined) {
			member = memberOf({ sf, path, node: stmt, kind: "ClassDeclaration", name: dotted(stmt.name.text) });
			outline.classes.push(member);
		} else if (ts.isInterfaceDeclaration(stmt)) {
			member = memberOf({ sf, path, node: stmt, name: dotted(stmt.name.text), kind: "InterfaceDeclaration" });
			outline.interfaces.push(member);
		} else if (ts.isFunctionDeclaration(stmt) && stmt.name !== undefined) {
			member = memberOf({ sf, path, node: stmt, kind: "FunctionDeclaration", name: dotted(stmt.name.text) });
			outline.functions.push(member);
		} else if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
			member = memberOf({ sf, path, node: stmt, kind: "ModuleDeclaration", name: dotted(stmt.name.text) });

			if (isExported(stmt)) {
				outline.exports.push(member);
			}

			walkOutline(walk, moduleStatements(stmt), dotted(stmt.name.text));
			continue; // namespace itself isn't a class/interface/fn/var bucket
		} else if (ts.isVariableStatement(stmt)) {
			for (const decl of stmt.declarationList.declarations) {
				if (ts.isIdentifier(decl.name)) {
					const vm = memberOf({ sf, path, node: stmt, kind: "VariableDeclaration", name: dotted(decl.name.text) });
					outline.variables.push(vm);

					if (isExported(stmt)) {
						outline.exports.push(vm);
					}
				}
			}

			continue;
		} else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier !== undefined && ts.isStringLiteral(stmt.moduleSpecifier)) {
			const fromModule = stmt.moduleSpecifier.text;

			if (stmt.exportClause === undefined) {
				// export * from "mod"
				const { col, line } = posOf(sf, stmt.getStart(sf));
				const sig = stmt.getText().replace(/\s+/g, " ");
				outline.exports.push({
					signature: sig,
					kind: "ExportDeclaration",
					name: `* from ${fromModule}`,
					position: { col, line, file: path }
				});
			} else if (ts.isNamedExports(stmt.exportClause)) {
				const declTypeOnly = stmt.isTypeOnly;

				for (const spec of stmt.exportClause.elements) {
					const typeOnly = declTypeOnly || spec.isTypeOnly;
					const exportedName = spec.name.text;
					const { col, line } = posOf(sf, spec.getStart(sf));
					const specText = spec.getText();
					outline.exports.push({
						name: exportedName,
						position: { col, line, file: path },
						signature: `export { ${specText} } from "${fromModule}"`,
						kind: typeOnly ? "ExportSpecifier (type)" : "ExportSpecifier"
					});
				}
			}

			continue;
		}

		if (member !== undefined && isExported(stmt)) {
			outline.exports.push(member);
		}
	}
}

/** Member declarations of a class/interface/namespace at a given position. */
export function outlineSymbolMembers(path: string, text: string, pos: LspPosition): Member[] {
	const sf = parse(path, text);
	const offset = sf.getPositionOfLineAndCharacter(pos.line, pos.character);
	const owner = ownerAt(sf, offset);

	if (owner === undefined) {
		return [];
	}

	const ownerName = (owner as ts.NamedDeclaration).name;
	const prefix = ownerName !== undefined && ts.isIdentifier(ownerName) ? ownerName.text : "";
	const members: Member[] = [];

	// Mirror ts-morph buildSymbolOutline: bare member `name`, owner-prefixed `qualifiedName`,
	// and unnamed members (constructor) named by their kind ("Constructor").
	const push = (name: string, node: ts.Node): void => {
		const qualified = prefix === "" ? `${path}:${name}` : `${path}:${prefix}${NS_SEP}${name}`;
		members.push(memberOf({ sf, path, name, node, qualified, kind: ts.SyntaxKind[node.kind] }));
	};

	if (ts.isClassDeclaration(owner) || ts.isInterfaceDeclaration(owner)) {
		for (const m of owner.members) {
			if (m.name !== undefined && ts.isIdentifier(m.name)) {
				push(m.name.text, m);
			} else if (ts.isConstructorDeclaration(m)) {
				push("Constructor", m);
			}
		}
	}

	return members;
}

function ownerAt(sf: ts.SourceFile, offset: number): ts.Node | undefined {
	let found: ts.Node | undefined;

	const visit = (node: ts.Node): void => {
		if (offset < node.getStart(sf) || offset >= node.getEnd()) {
			return;
		}

		if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isModuleDeclaration(node)) {
			found = node;
		}

		node.forEachChild(visit);
	};

	visit(sf);

	return found;
}

export function functionSkeleton(path: string, text: string, pos: LspPosition, depth: number): StatementNode[] {
	const sf = parse(path, text);
	const offset = sf.getPositionOfLineAndCharacter(pos.line, pos.character);
	const fn = functionAt(sf, offset);
	const body = fn !== undefined ? fnBody(fn) : undefined;

	return body === undefined ? [] : body.statements.map((s) => statementNode(sf, s, depth));
}

function statementNode(sf: ts.SourceFile, stmt: ts.Statement, depth: number): StatementNode {
	const { col, line } = posOf(sf, stmt.getStart(sf));
	const node: StatementNode = { kind: ts.SyntaxKind[stmt.kind], position: { col, line, file: sf.fileName } };

	if (depth > 1) {
		const inner: ts.Statement[] = [];

		stmt.forEachChild((c) => {
			if (ts.isBlock(c)) {
				inner.push(...c.statements);
			}
		});

		if (inner.length > 0) {
			node.children = inner.map((s) => statementNode(sf, s, depth - 1));
		}
	}

	return node;
}

function functionAt(sf: ts.SourceFile, offset: number): ts.Node | undefined {
	let found: ts.Node | undefined;

	const visit = (node: ts.Node): void => {
		if (offset < node.getStart(sf) || offset >= node.getEnd()) {
			return;
		}

		if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
			found = node;
		}

		node.forEachChild(visit);
	};

	visit(sf);

	return found;
}

function fnBody(node: ts.Node): ts.Block | undefined {
	const body = (node as ts.FunctionLikeDeclaration).body;

	return body !== undefined && ts.isBlock(body) ? body : undefined;
}

/** Exact source of the smallest enclosing declaration at the given LSP position. */
export function declarationSourceAt(text: string, pos: LspPosition): string | undefined {
	const sf = parse("__src.ts", text);
	const offset = sf.getPositionOfLineAndCharacter(pos.line, pos.character);
	let decl: ts.Node | undefined;

	const visit = (node: ts.Node): void => {
		if (offset < node.getStart(sf) || offset >= node.getEnd()) {
			return;
		}

		if (
			ts.isClassDeclaration(node) ||
			ts.isInterfaceDeclaration(node) ||
			ts.isFunctionDeclaration(node) ||
			ts.isTypeAliasDeclaration(node) ||
			ts.isModuleDeclaration(node) ||
			ts.isVariableStatement(node) ||
			ts.isMethodDeclaration(node) ||
			ts.isPropertyDeclaration(node)
		) {
			decl = node;
		}

		node.forEachChild(visit);
	};

	visit(sf);

	return decl?.getText(sf);
}

/** Distinct named types referenced anywhere in the given declaration source. */
export function typeRefsIn(text: string): string[] {
	const sf = parse("__types.ts", text);
	const names = new Set<string>();

	const visit = (node: ts.Node): void => {
		if (ts.isTypeReferenceNode(node)) {
			names.add(node.typeName.getText(sf));
		}

		node.forEachChild(visit);
	};

	visit(sf);

	return [...names];
}

/** The declaration head up to its body — single line, whitespace-collapsed. */
export function signatureOfSource(source: string): string {
	const brace = source.indexOf("{");
	const head = brace === -1 ? source : source.slice(0, brace);

	return head.trim().replace(/\s+/g, " ");
}
