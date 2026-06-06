/**
 * Reference classification for findUsages. Maps a ts-morph reference node to a
 * ReferenceKind by inspecting its syntactic context. Deterministic, no LLM.
 */
import { Node, SyntaxKind } from "ts-morph";

import type { ReferenceKind } from "./types.js";

export function classifyReference(node: Node): ReferenceKind {
	if (node.getFirstAncestorByKind(SyntaxKind.ImportSpecifier) !== undefined) {
		return "import";
	}

	if (node.getFirstAncestorByKind(SyntaxKind.ImportClause) !== undefined || node.getFirstAncestorByKind(SyntaxKind.NamespaceImport) !== undefined) {
		return "import";
	}

	if (isInTypePosition(node)) {
		return "type-ref";
	}

	if (isCallTarget(node)) {
		return "call";
	}

	if (isWriteTarget(node)) {
		return "write";
	}

	return "read";
}

function isCallTarget(node: Node): boolean {
	let parent = node.getParent();

	// For a qualified call `A.b()`, the node is the property-access name; step up to
	// the property-access so the call/new check below sees it as the call expression.
	if (parent !== undefined && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) {
		node = parent;
		parent = parent.getParent();
	}

	if (parent === undefined) {
		return false;
	}

	if (Node.isCallExpression(parent) && parent.getExpression() === node) {
		return true;
	}

	if (Node.isNewExpression(parent) && parent.getExpression() === node) {
		return true;
	}

	return false;
}

function isInTypePosition(node: Node): boolean {
	return node.getFirstAncestorByKind(SyntaxKind.TypeReference) !== undefined || node.getFirstAncestorByKind(SyntaxKind.TypeQuery) !== undefined;
}

function isWriteTarget(node: Node): boolean {
	const parent = node.getParent();

	if (parent === undefined) {
		return false;
	}

	if (Node.isBinaryExpression(parent) && parent.getLeft() === node) {
		return parent.getOperatorToken().getText() === "=";
	}

	return false;
}
