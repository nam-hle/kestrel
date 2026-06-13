/**
 * Deterministic structural outline of a file. AST walk, no LLM.
 * See docs/VISION.md (outline ops), docs/DESIGN.md Section 2.
 */
import { Node } from "ts-morph";
import type { Statement, SourceFile } from "ts-morph";

import { RELEASE_TAGS } from "./types.js";
import type { Member, FileOutline, StatementNode } from "./types.js";
import { position, joinSegments, outlineDeclarations } from "./resolve.js";

/** Single-line signature: declaration text up to its body (or the whole line). */
function signatureOf(node: Node): string {
	const text = node.getText();
	const brace = text.indexOf("{");
	const head = brace === -1 ? text : text.slice(0, brace);

	return head.trim().replace(/\s+/g, " ");
}

function typeParametersOf(node: Node): string[] | undefined {
	const holder = Node.isVariableDeclaration(node) ? node.getInitializer() : node;

	if (
		holder === undefined ||
		!(
			Node.isClassDeclaration(holder) ||
			Node.isInterfaceDeclaration(holder) ||
			Node.isTypeAliasDeclaration(holder) ||
			Node.isFunctionDeclaration(holder)
		)
	) {
		return undefined;
	}

	const params = holder.getTypeParameters().map((p) => p.getName());

	return params.length > 0 ? params : undefined;
}

/**
 * Declaration modifiers present on a node, lower-cased: `abstract`, `static`, `readonly`,
 * `async`, `optional`, `default`. `export` is tracked separately (Member.exported).
 */
function modifiersOf(node: Node): string[] {
	const mods: string[] = [];

	if (Node.isAbstractable(node) && node.isAbstract()) {
		mods.push("abstract");
	}

	if (Node.isStaticable(node) && node.isStatic()) {
		mods.push("static");
	}

	if (Node.isReadonlyable(node) && node.isReadonly()) {
		mods.push("readonly");
	}

	if (Node.isAsyncable(node) && node.isAsync()) {
		mods.push("async");
	}

	if (Node.isQuestionTokenable(node) && node.hasQuestionToken()) {
		mods.push("optional");
	}

	if (Node.isModifierable(node) && node.hasModifier("default")) {
		mods.push("default");
	}

	return mods;
}

/** JSDoc release tags on a node, in RELEASE_TAGS display order. */
export function tagsOf(node: Node): string[] {
	// A `const`/`let` declaration carries its JSDoc on the enclosing VariableStatement, not
	// the VariableDeclaration the outline walk hands us.
	const docHost = Node.isVariableDeclaration(node) ? (node.getVariableStatement() ?? node) : node;

	if (!Node.isJSDocable(docHost)) {
		return [];
	}

	const present = new Set(docHost.getJsDocs().flatMap((doc) => doc.getTags().map((t) => t.getTagName().toLowerCase())));

	return RELEASE_TAGS.filter((t) => present.has(t));
}

function toMember(node: Node, name: string, baseDir: string): Member {
	const typeParameters = typeParametersOf(node);
	const modifiers = modifiersOf(node);
	const tags = tagsOf(node);

	return {
		name,
		kind: node.getKindName(),
		signature: signatureOf(node),
		position: position(node, baseDir),
		...(modifiers.length > 0 ? { modifiers } : {}),
		...(tags.length > 0 ? { tags } : {}),
		...(typeParameters !== undefined ? { typeParameters } : {})
	};
}

/** Direct child statements of a statement (into its block/body), one level down. */
function childStatements(node: Node): Statement[] {
	const result: Statement[] = [];
	node.forEachChild((child) => {
		if (Node.isBlock(child)) {
			result.push(...child.getStatements());
		} else if (Node.isStatement(child)) {
			result.push(child);
		}
	});

	return result;
}

/** The declared name a statement introduces, when it has one (fn/class decl, named var statement). */
function statementLabel(stmt: Node): string | undefined {
	if (Node.isFunctionDeclaration(stmt) || Node.isClassDeclaration(stmt)) {
		return stmt.getName();
	}

	if (Node.isVariableStatement(stmt)) {
		const names = stmt.getDeclarations().map((d) => d.getName());

		return names.length > 0 ? names.join(", ") : undefined;
	}

	return undefined;
}

function buildStatementNode(stmt: Node, depth: number, baseDir: string): StatementNode {
	const node: StatementNode = { kind: stmt.getKindName(), position: position(stmt, baseDir) };
	const label = statementLabel(stmt);

	if (label !== undefined) {
		node.label = label;
	}

	if (depth > 1) {
		const children = childStatements(stmt).map((child) => buildStatementNode(child, depth - 1, baseDir));

		if (children.length > 0) {
			node.children = children;
		}
	}

	return node;
}

/** Find the body block of a function-like declaration, including arrow/fn-expr consts. */
function functionBody(decl: Node): Node | undefined {
	const direct = decl.forEachChildAsArray().find((c) => Node.isBlock(c));

	if (direct !== undefined) {
		return direct;
	}

	// Arrow / function-expression assigned to a const: descend to the initializer's block.
	if (Node.isVariableDeclaration(decl)) {
		const init = decl.getInitializer();

		if (init !== undefined && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
			const body = init.getBody();

			return Node.isBlock(body) ? body : undefined;
		}
	}

	return undefined;
}

/** Deterministic statement-level skeleton of a function body. */
export function buildFunctionOutline(decl: Node, depth: number, baseDir: string): StatementNode[] {
	const body = functionBody(decl);

	if (body === undefined || !Node.isBlock(body)) {
		return [];
	}

	return body.getStatements().map((stmt) => buildStatementNode(stmt, depth, baseDir));
}

/** Members of a class / interface / namespace declaration. `ownerQualifiedName` (file:Owner)
 * prefixes each member's addressable qualifiedName. */
export function buildSymbolOutline(decl: Node, baseDir: string, ownerQualifiedName?: string): Member[] {
	const withQName = (member: Member, name: string): Member =>
		ownerQualifiedName === undefined ? member : { ...member, qualifiedName: joinSegments([ownerQualifiedName, name]) };

	if (Node.isModuleDeclaration(decl)) {
		const body = decl.getBody();
		const statements = body !== undefined && Node.isModuleBlock(body) ? body.getStatements() : [];

		return statements.flatMap((stmt) => {
			if (!Node.hasName(stmt)) {
				return [];
			}

			const name = stmt.getName();

			return name === undefined ? [] : [withQName(toMember(stmt, name, baseDir), name)];
		});
	}

	const members: Node[] = [];

	if (Node.isClassDeclaration(decl)) {
		members.push(...decl.getMembers());
	} else if (Node.isInterfaceDeclaration(decl)) {
		members.push(...decl.getMembers());
	} else {
		return [];
	}

	return members.map((member) => {
		const name = Node.hasName(member) ? (member.getName() ?? "") : member.getKindName();

		return withQName(toMember(member, name, baseDir), name);
	});
}

export function buildFileOutline(sourceFile: SourceFile, baseDir: string): FileOutline {
	const outline: FileOutline = { others: [], exports: [], classes: [], functions: [], variables: [], interfaces: [] };

	// outlineDeclarations = top-level + namespaces + type members (no function-body locals).
	for (const { node, path } of outlineDeclarations(sourceFile)) {
		// A VariableDeclaration's export modifier lives on its parent VariableStatement.
		const exportHolder = Node.isVariableDeclaration(node) ? node.getVariableStatement() : node;
		const exported = exportHolder !== undefined && Node.isExportable(exportHolder) && exportHolder.isExported();
		const base = toMember(node, path, baseDir);
		const member: Member = { ...base, exported, qualifiedName: `${base.position.file}:${path}` };

		if (Node.isClassDeclaration(node)) {
			outline.classes.push(member);
		} else if (Node.isInterfaceDeclaration(node)) {
			outline.interfaces.push(member);
		} else if (Node.isFunctionDeclaration(node)) {
			outline.functions.push(member);
		} else if (Node.isVariableDeclaration(node)) {
			// A const assigned a function/arrow reads as a function; everything else is a value.
			const init = node.getInitializer();
			const isFn = init !== undefined && (Node.isArrowFunction(init) || Node.isFunctionExpression(init));
			(isFn ? outline.functions : outline.variables).push(member);
		} else {
			// Namespaces, enums, type aliases, and type members — still carry export/modifier flags.
			outline.others.push(member);
		}

		if (exported) {
			outline.exports.push(member);
		}
	}

	// Re-exports: `export { X } from "..."`, `export type { X } from`, `export * from`.
	for (const exportDecl of sourceFile.getExportDeclarations()) {
		const fromModule = exportDecl.getModuleSpecifierValue();

		if (fromModule === undefined) {
			continue;
		}

		const named = exportDecl.getNamedExports();

		if (named.length === 0) {
			outline.exports.push({
				kind: "ExportDeclaration",
				name: `* from ${fromModule}`,
				position: position(exportDecl, baseDir),
				signature: exportDecl.getText().replace(/\s+/g, " ")
			});
			continue;
		}

		const declTypeOnly = exportDecl.isTypeOnly();

		for (const spec of named) {
			const typeOnly = declTypeOnly || spec.isTypeOnly();

			outline.exports.push({
				position: position(spec, baseDir),
				name: spec.getAliasNode()?.getText() ?? spec.getName(),
				kind: typeOnly ? "ExportSpecifier (type)" : "ExportSpecifier",
				signature: `export { ${spec.getText()} } from "${fromModule}"`
			});
		}
	}

	return outline;
}
