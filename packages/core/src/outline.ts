/**
 * Deterministic structural outline of a file. AST walk, no LLM.
 * See docs/VISION.md (outline ops), docs/DESIGN.md Section 2.
 */
import { Node } from "ts-morph";
import type { Statement, SourceFile } from "ts-morph";

import { position, allDeclarations } from "./resolve.js";
import type { Member, FileOutline, StatementNode } from "./types.js";

/** Single-line signature: declaration text up to its body (or the whole line). */
function signatureOf(node: Node): string {
	const text = node.getText();
	const brace = text.indexOf("{");
	const head = brace === -1 ? text : text.slice(0, brace);

	return head.trim().replace(/\s+/g, " ");
}

function toMember(node: Node, name: string, baseDir: string): Member {
	return {
		name,
		kind: node.getKindName(),
		signature: signatureOf(node),
		position: position(node, baseDir)
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

function buildStatementNode(stmt: Node, depth: number, baseDir: string): StatementNode {
	const node: StatementNode = { kind: stmt.getKindName(), position: position(stmt, baseDir) };

	if (depth > 1) {
		const children = childStatements(stmt).map((child) => buildStatementNode(child, depth - 1, baseDir));

		if (children.length > 0) {
			node.children = children;
		}
	}

	return node;
}

/** Deterministic statement-level skeleton of a function body. */
export function buildFunctionOutline(decl: Node, depth: number, baseDir: string): StatementNode[] {
	const body = decl.forEachChildAsArray().find((c) => Node.isBlock(c));

	if (!body || !Node.isBlock(body)) {
		return [];
	}

	return body.getStatements().map((stmt) => buildStatementNode(stmt, depth, baseDir));
}

/** Members of a class / interface / namespace declaration. */
export function buildSymbolOutline(decl: Node, baseDir: string): Member[] {
	if (Node.isModuleDeclaration(decl)) {
		const body = decl.getBody();
		const statements = body !== undefined && Node.isModuleBlock(body) ? body.getStatements() : [];

		return statements.flatMap((stmt) => {
			if (!Node.hasName(stmt)) {
				return [];
			}

			const name = stmt.getName();

			return name === undefined ? [] : [toMember(stmt, name, baseDir)];
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

		return toMember(member, name, baseDir);
	});
}

export function buildFileOutline(sourceFile: SourceFile, baseDir: string): FileOutline {
	const outline: FileOutline = { exports: [], classes: [], functions: [], interfaces: [] };

	// allDeclarations recurses namespaces and tags each with its dotted path.
	for (const { node, path } of allDeclarations(sourceFile)) {
		const member = toMember(node, path, baseDir);

		if (Node.isClassDeclaration(node)) {
			outline.classes.push(member);
		} else if (Node.isInterfaceDeclaration(node)) {
			outline.interfaces.push(member);
		} else if (Node.isFunctionDeclaration(node)) {
			outline.functions.push(member);
		}

		if (Node.isExportable(node) && node.isExported()) {
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

		for (const spec of named) {
			outline.exports.push({
				kind: "ExportSpecifier",
				position: position(spec, baseDir),
				name: spec.getAliasNode()?.getText() ?? spec.getName(),
				signature: `export { ${spec.getText()} } from "${fromModule}"`
			});
		}
	}

	return outline;
}
