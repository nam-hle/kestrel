/**
 * Syntactic ops via the typescript native API — for what tsgo's LSP cannot serve
 * (imports, outline detail, function bodies, reference-kind classification). Parses a
 * single file; no project, no typecheck.
 */
import ts from "typescript";

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

	for (const stmt of sf.statements) {
		let member: Member | undefined;

		if (ts.isClassDeclaration(stmt) && stmt.name !== undefined) {
			member = memberOf({ sf, path, node: stmt, name: stmt.name.text, kind: "ClassDeclaration" });
			outline.classes.push(member);
		} else if (ts.isInterfaceDeclaration(stmt)) {
			member = memberOf({ sf, path, node: stmt, name: stmt.name.text, kind: "InterfaceDeclaration" });
			outline.interfaces.push(member);
		} else if (ts.isFunctionDeclaration(stmt) && stmt.name !== undefined) {
			member = memberOf({ sf, path, node: stmt, name: stmt.name.text, kind: "FunctionDeclaration" });
			outline.functions.push(member);
		} else if (ts.isVariableStatement(stmt)) {
			for (const decl of stmt.declarationList.declarations) {
				if (ts.isIdentifier(decl.name)) {
					const vm = memberOf({ sf, path, node: stmt, name: decl.name.text, kind: "VariableDeclaration" });
					outline.variables.push(vm);

					if (isExported(stmt)) {
						outline.exports.push(vm);
					}
				}
			}
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

			// skip adding `member` for export declarations — handled above
			continue;
		}

		if (member !== undefined && isExported(stmt)) {
			outline.exports.push(member);
		}
	}

	return outline;
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
		const qualified = prefix === "" ? `${path}:${name}` : `${path}:${prefix}.${name}`;
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
