/**
 * Call-hierarchy traversal — incoming callers or outgoing callees of a symbol,
 * walked to a bounded depth. Deterministic (ts-morph references + definitions).
 */
import { Node } from "ts-morph";

import { position } from "./resolve.js";
import type { CallNode } from "./types.js";

/** The nearest enclosing function-like declaration of a node (named where possible). */
function enclosingNamed(node: Node): Node | undefined {
	for (const a of node.getAncestors()) {
		if (Node.isFunctionDeclaration(a) || Node.isMethodDeclaration(a)) {
			return a;
		}

		// Arrow / function-expression assigned to a const: report the variable declaration
		// (it carries the name), not the function expression itself.
		if (Node.isArrowFunction(a) || Node.isFunctionExpression(a)) {
			const parent = a.getParent();

			return parent !== undefined && Node.isVariableDeclaration(parent) ? parent : a;
		}
	}

	return undefined;
}

/** A name for a node used in the hierarchy (the declaration's name, best effort). */
function nodeName(node: Node): string {
	if (Node.hasName(node)) {
		return node.getName() ?? "(anonymous)";
	}

	if (Node.isVariableDeclaration(node)) {
		return node.getName();
	}

	const parent = node.getParent();

	if (parent !== undefined && Node.isVariableDeclaration(parent)) {
		return parent.getName();
	}

	return "(anonymous)";
}

function toNode(decl: Node, baseDir: string): CallNode {
	const pos = position(decl, baseDir);

	return { calls: [], position: pos, qualifiedName: `${pos.file}:${nodeName(decl)}` };
}

/** Functions that call `decl` (one level), as their enclosing named declarations. */
function callersOf(decl: Node): Node[] {
	if (!Node.isReferenceFindable(decl)) {
		return [];
	}

	const callers: Node[] = [];

	for (const ref of decl.findReferencesAsNodes()) {
		const enclosing = enclosingNamed(ref);

		if (enclosing !== undefined && enclosing !== decl) {
			callers.push(enclosing);
		}
	}

	return callers;
}

/**
 * A declaration that lives in `node_modules` or a TypeScript `lib.*.d.ts` — i.e. a
 * built-in (`String`, `Error`, `Array`, …) or third-party intrinsic, not the user's
 * code. These are noise as call-hierarchy edges and are filtered out.
 */
function isExternalDeclaration(decl: Node): boolean {
	const path = decl.getSourceFile().getFilePath();

	return path.includes("/node_modules/") || /\/lib\.[^/]*\.d\.ts$/.test(path);
}

/** Declarations that `decl` calls (one level), resolved from its body's call expressions. */
function calleesOf(decl: Node): Node[] {
	const callees: Node[] = [];

	decl.forEachDescendant((node) => {
		if (!Node.isCallExpression(node) && !Node.isNewExpression(node)) {
			return;
		}

		const expr = node.getExpression();
		const target = Node.isPropertyAccessExpression(expr) ? expr.getNameNode() : expr;

		if (!Node.isIdentifier(target)) {
			return;
		}

		for (const def of target.getDefinitionNodes()) {
			if (isExternalDeclaration(def)) {
				continue;
			}

			const named = Node.isFunctionDeclaration(def) || Node.isMethodDeclaration(def) ? def : (enclosingNamed(def) ?? def);
			callees.push(named);
		}
	});

	return callees;
}

export function buildCallHierarchy(decl: Node, direction: "incoming" | "outgoing", depth: number, baseDir: string): CallNode[] {
	const seen = new Set<Node>();

	const walk = (current: Node, remaining: number): CallNode[] => {
		if (remaining <= 0) {
			return [];
		}

		const next = direction === "incoming" ? callersOf(current) : calleesOf(current);
		const result: CallNode[] = [];

		for (const node of next) {
			if (seen.has(node)) {
				continue;
			}

			seen.add(node);
			const callNode = toNode(node, baseDir);
			callNode.calls = walk(node, remaining - 1);
			result.push(callNode);
		}

		return result;
	};

	return walk(decl, depth);
}
