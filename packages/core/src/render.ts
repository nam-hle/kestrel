/**
 * Compact text rendering of outlines — a token-lean YAML-ish tree, the default
 * agent-facing format. Namespace/owner prefixes are factored out into nesting.
 */
import type { Member, Position, Candidate, FileOutline, SymbolHandle, UsagesResult, ResolveResult, SourceResult, RegionResult, StatementNode, SymbolContext, CallNode, ImportInfo, UsageReportEntry } from "./types.js";

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

/** Re-feedable address of a position: file:line:col. */
function addr(pos: Position): string {
	return `${pos.file}:${pos.line}:${pos.col}`;
}

/** A symbol-row: qualifiedName-first (the next-query input), kind + line after. */
function candidateRow(c: Candidate): string {
	return `${c.qualifiedName}\t${c.kind}\tL${c.position.line}`;
}

export function renderReferences(result: UsagesResult): string {
	if (result.references.length === 0) {
		return "(no references)";
	}

	const rows = result.references.map((r) => {
		const parts = [addr(r.position), r.kind, ...(r.context !== undefined ? [r.context] : []), ...(r.test === true ? ["(test)"] : [])];

		return parts.join("\t");
	});
	const cursor = result.nextCursor !== undefined ? ` (more: cursor ${result.nextCursor})` : "";

	return `${rows.join("\n")}\n${result.total} refs${cursor}`;
}

export function renderHandles(handles: SymbolHandle[]): string {
	if (handles.length === 0) {
		return "(none)";
	}

	return handles.map((h) => `${addr(h.position)}\t${h.qualifiedName}`).join("\n");
}

export function renderCandidates(candidates: Candidate[]): string {
	return candidates.length === 0 ? "(none)" : candidates.map(candidateRow).join("\n");
}

export function renderResolve(result: ResolveResult): string {
	if (result.kind === "symbol") {
		return `${result.symbol.qualifiedName}\tL${result.symbol.position.line}`;
	}

	if (result.kind === "ambiguous") {
		return result.candidates.map(candidateRow).join("\n");
	}

	return result.suggestions !== undefined && result.suggestions.length > 0
		? `not found\ndid you mean: ${result.suggestions.join(", ")}`
		: "not found";
}

export function renderSource(sources: SourceResult[]): string {
	if (sources.length === 0) {
		return "(no source)";
	}

	return sources.map((s) => `${addr(s.position)}\t${s.qualifiedName}\n${s.source}`).join("\n\n");
}

export function renderRegion(r: RegionResult): string {
	return `${r.file}:${r.startLine}-${r.endLine}\n${r.source}`;
}

export function renderMembers(members: Member[]): string {
	return members.length === 0 ? "(no members)" : members.map((m) => `${m.name}\t${m.kind}\tL${m.position.line}`).join("\n");
}

export function renderStatements(nodes: StatementNode[], indent = ""): string {
	if (nodes.length === 0 && indent === "") {
		return "(empty)";
	}

	const lines: string[] = [];

	for (const node of nodes) {
		lines.push(`${indent}${node.kind}\tL${node.position.line}`);

		if (node.children !== undefined && node.children.length > 0) {
			lines.push(renderStatements(node.children, `${indent}  `));
		}
	}

	return lines.join("\n");
}

function renderCallNodes(nodes: CallNode[], indent: string, lines: string[]): void {
	for (const node of nodes) {
		const name = node.qualifiedName.split(":").pop() ?? node.qualifiedName;
		lines.push(`${indent}${name}\t${addr(node.position)}`);
		renderCallNodes(node.calls, `${indent}  `, lines);
	}
}

export function renderCallHierarchy(tree: CallNode[]): string {
	if (tree.length === 0) {
		return "(none)";
	}

	const lines: string[] = [];
	renderCallNodes(tree, "", lines);

	return lines.join("\n");
}

export function renderContext(ctx: SymbolContext): string {
	const lines = [`${addr(ctx.position)}\t${ctx.qualifiedName}`, `sig: ${ctx.signature}`];

	if (ctx.typeRefs.length > 0) {
		lines.push(`types: ${ctx.typeRefs.join(", ")}`);
	}

	if (ctx.callees.length > 0) {
		lines.push("callees:");
		const calleeLines: string[] = [];
		renderCallNodes(ctx.callees, "  ", calleeLines);
		lines.push(...calleeLines);
	}

	lines.push("---", ctx.source);

	return lines.join("\n");
}

export function renderImports(imports: ImportInfo[]): string {
	if (imports.length === 0) {
		return "(no imports)";
	}

	return imports
		.map((i) => {
			const parts = [i.module];

			if (i.named.length > 0) {
				parts.push(i.named.join(", "));
			}

			if (i.default !== undefined) {
				parts.push(`default ${i.default}`);
			}

			if (i.namespace !== undefined) {
				parts.push(`* as ${i.namespace}`);
			}

			return parts.join("\t");
		})
		.join("\n");
}

export function renderUsageReport(rows: UsageReportEntry[]): string {
	if (rows.length === 0) {
		return "(no exports)";
	}

	return rows.map((r) => `${r.qualifiedName}\ttotal=${r.total} consumed=${r.consumed}\t${r.kind}`).join("\n");
}
