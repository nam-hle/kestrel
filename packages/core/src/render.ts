/**
 * Compact text rendering of outlines — a token-lean YAML-ish tree, the default
 * agent-facing format. Namespace/owner prefixes are factored out into nesting.
 */
import type { Member, FileOutline } from "./types.js";

interface TreeNode {
	children: Map<string, TreeNode>;
	leaf?: { kind: string; line: number; exported: boolean };
}

const KIND_SHORT: Record<string, string> = {
	EnumDeclaration: "enum",
	ClassDeclaration: "class",
	FunctionDeclaration: "fn",
	MethodSignature: "method",
	PropertySignature: "prop",
	MethodDeclaration: "method",
	PropertyDeclaration: "prop",
	VariableDeclaration: "const",
	TypeAliasDeclaration: "type",
	ModuleDeclaration: "namespace",
	InterfaceDeclaration: "interface"
};

function shortKind(kind: string): string {
	return KIND_SHORT[kind] ?? kind;
}

/** Insert a dotted-path member into the prefix tree. */
function insert(root: TreeNode, member: Member): void {
	const parts = member.name.split(".");
	let node = root;

	for (const part of parts) {
		let child = node.children.get(part);

		if (child === undefined) {
			child = { children: new Map() };
			node.children.set(part, child);
		}

		node = child;
	}

	node.leaf = { line: member.position.line, kind: shortKind(member.kind), exported: member.exported === true };
}

function renderNode(name: string, node: TreeNode, indent: string, lines: string[]): void {
	const leaf = node.leaf;
	const tag = leaf?.exported === true ? " [x]" : "";
	const meta = leaf !== undefined ? `${leaf.kind} ` : "namespace ";
	const loc = leaf !== undefined ? `  L${leaf.line}` : "";
	lines.push(`${indent}${meta}${name}${loc}${tag}`);

	const childNames = [...node.children.keys()].sort((a, b) => {
		const la = node.children.get(a)!.leaf?.line ?? 0;
		const lb = node.children.get(b)!.leaf?.line ?? 0;

		return la - lb;
	});

	for (const childName of childNames) {
		renderNode(childName, node.children.get(childName)!, `${indent}  `, lines);
	}
}

/** Render a file outline as a compact tree. Declarations only (re-exports listed separately). */
export function renderFileOutline(file: string, outline: FileOutline): string {
	const root: TreeNode = { children: new Map() };

	for (const member of [...outline.classes, ...outline.interfaces, ...outline.functions, ...outline.variables]) {
		insert(root, member);
	}

	const lines: string[] = [`${file}:`];
	const topNames = [...root.children.keys()].sort((a, b) => {
		const la = root.children.get(a)!.leaf?.line ?? 0;
		const lb = root.children.get(b)!.leaf?.line ?? 0;

		return la - lb;
	});

	for (const name of topNames) {
		renderNode(name, root.children.get(name)!, "  ", lines);
	}

	// Re-exports that are not local declarations (barrel pass-throughs).
	const reExports = outline.exports.filter((e) => e.kind.startsWith("Export"));

	if (reExports.length > 0) {
		lines.push("  re-exports:");

		for (const re of reExports) {
			const t = re.kind === "ExportSpecifier (type)" ? " (type)" : "";
			lines.push(`    ${re.name}${t}`);
		}
	}

	return lines.join("\n");
}
