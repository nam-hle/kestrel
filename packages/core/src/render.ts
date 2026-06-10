import { splitName } from "./resolve.js";
/**
 * Compact text rendering of outlines — a token-lean YAML-ish tree, the default
 * agent-facing format. Namespace/owner prefixes are factored out into nesting.
 */
import type {
	Member,
	Position,
	CallNode,
	Candidate,
	ImportInfo,
	FileOutline,
	SymbolHandle,
	UsagesResult,
	SourceResult,
	RegionResult,
	ResolveResult,
	StatementNode,
	SymbolContext,
	UsageReportEntry
} from "./types.js";

interface TreeNode {
	children: Map<string, TreeNode>;
	leaf?: { kind: string; line: number; tags?: string[]; exported: boolean; modifiers?: string[] };
}

/** Bracketed JSDoc release-tag prefix, e.g. `[deprecated] `; empty when none. */
function tagPrefix(tags: string[] | undefined): string {
	return tags !== undefined && tags.length > 0 ? `${tags.map((t) => `[${t}]`).join(" ")} ` : "";
}

const KIND_SHORT: Record<string, string> = {
	EnumDeclaration: "enum",
	ClassDeclaration: "cls",
	MethodSignature: "meth",
	ModuleDeclaration: "ns",
	FunctionDeclaration: "fn",
	PropertySignature: "prop",
	MethodDeclaration: "meth",
	PropertyDeclaration: "prop",
	VariableDeclaration: "const",
	TypeAliasDeclaration: "type",
	InterfaceDeclaration: "iface"
};

/** Compact a ts-morph getKindName() string to its short label (e.g. InterfaceDeclaration → iface). */
export function shortKind(kind: string): string {
	return KIND_SHORT[kind] ?? kind;
}

/** Single-uppercase-letter flag for each modifier, plus the labels used in the legend footer. */
const FLAG: Record<string, { label: string; letter: string }> = {
	async: { letter: "Y", label: "async" },
	export: { letter: "E", label: "export" },
	static: { letter: "S", label: "static" },
	default: { letter: "D", label: "default" },
	abstract: { letter: "A", label: "abstract" },
	readonly: { letter: "R", label: "readonly" },
	optional: { letter: "O", label: "optional" }
};

/** Stable display order of flags within a token (export first, then declaration modifiers). */
const FLAG_ORDER = ["export", "abstract", "static", "readonly", "async", "optional", "default"];

/**
 * The flag token for a declaration (e.g. `ES` = exported + static), and the modifier names it
 * used — collected by the caller to build a legend footer of only the flags that appear.
 */
function flagToken(exported: boolean, modifiers: string[] | undefined, used: Set<string>): string {
	const present = [...(exported ? ["export"] : []), ...(modifiers ?? [])];
	const ordered = FLAG_ORDER.filter((m) => present.includes(m));

	for (const m of ordered) {
		used.add(m);
	}

	return ordered.map((m) => FLAG[m]!.letter).join("");
}

/** Legend line decoding only the flags that appeared, e.g. `E=export S=static`. Empty when none. */
function legend(used: Set<string>): string {
	const items = FLAG_ORDER.filter((m) => used.has(m)).map((m) => `${FLAG[m]!.letter}=${FLAG[m]!.label}`);

	return items.length > 0 ? `—\n${items.join("  ")}` : "";
}

/** Common directory of a project-relative path (everything up to the last slash), or "" if none. */
function dirOf(file: string): string {
	const slash = file.lastIndexOf("/");

	return slash === -1 ? "" : file.slice(0, slash);
}

/** Basename of a path. */
function baseOf(file: string): string {
	const slash = file.lastIndexOf("/");

	return slash === -1 ? file : file.slice(slash + 1);
}

/** Insert a `::`-path member into the prefix tree. */
function insert(root: TreeNode, member: Member): void {
	const parts = splitName(member.name);
	let node = root;

	for (const part of parts) {
		let child = node.children.get(part);

		if (child === undefined) {
			child = { children: new Map() };
			node.children.set(part, child);
		}

		node = child;
	}

	node.leaf = {
		line: member.position.line,
		kind: shortKind(member.kind),
		exported: member.exported === true,
		...(member.modifiers !== undefined ? { modifiers: member.modifiers } : {}),
		...(member.tags !== undefined ? { tags: member.tags } : {})
	};
}

/**
 * Source line a tree node sorts by: its own declaration line, or — for a container with no
 * leaf of its own, e.g. a namespace whose members were inserted but the namespace wasn't —
 * the earliest line among its descendants. Without this, container nodes default to 0 and
 * float above earlier top-level declarations, so the outline isn't in source order.
 */
function nodeLine(node: TreeNode): number {
	if (node.leaf !== undefined) {
		return node.leaf.line;
	}

	let min = Infinity;

	for (const child of node.children.values()) {
		min = Math.min(min, nodeLine(child));
	}

	return min === Infinity ? 0 : min;
}

/** Mutable accumulators threaded through the outline walk. */
interface OutlineSink {
	lines: string[];
	used: Set<string>;
}

function renderNode(name: string, node: TreeNode, indent: string, sink: OutlineSink): void {
	const leaf = node.leaf;
	const kind = leaf !== undefined ? leaf.kind : "ns";
	const flags = leaf !== undefined ? flagToken(leaf.exported, leaf.modifiers, sink.used) : "";
	const prefix = flags !== "" ? `${flags} ` : "";
	const tags = leaf !== undefined ? tagPrefix(leaf.tags) : "";
	const loc = leaf !== undefined ? `  L${leaf.line}` : "";
	sink.lines.push(`${indent}${tags}${prefix}${kind} ${name}${loc}`);

	const childNames = [...node.children.keys()].sort((a, b) => nodeLine(node.children.get(a)!) - nodeLine(node.children.get(b)!));

	for (const childName of childNames) {
		renderNode(childName, node.children.get(childName)!, `${indent}  `, sink);
	}
}

/** Render a file outline as a compact tree. Declarations only (re-exports listed separately). */
export function renderFileOutline(file: string, outline: FileOutline): string {
	const root: TreeNode = { children: new Map() };

	for (const member of [...outline.classes, ...outline.interfaces, ...outline.functions, ...outline.variables, ...outline.others]) {
		insert(root, member);
	}

	const sink: OutlineSink = { lines: [`${file}:`], used: new Set<string>() };
	const topNames = [...root.children.keys()].sort((a, b) => nodeLine(root.children.get(a)!) - nodeLine(root.children.get(b)!));

	for (const name of topNames) {
		renderNode(name, root.children.get(name)!, "  ", sink);
	}

	const { used, lines } = sink;

	// Re-exports that are not local declarations (barrel pass-throughs).
	const reExports = outline.exports.filter((e) => e.kind.startsWith("Export"));

	if (reExports.length > 0) {
		lines.push("  re-exports:");

		for (const re of reExports) {
			const t = re.kind === "ExportSpecifier (type)" ? " (type)" : "";
			lines.push(`    ${re.name}${t}`);
		}
	}

	const foot = legend(used);

	return foot !== "" ? `${lines.join("\n")}\n${foot}` : lines.join("\n");
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

	// Group references by directory: print each dir once as a header with its hit count,
	// then bare `basename:line:col<TAB>kind` rows under it. dir header + basename reconstructs
	// the full re-feedable path. Dirs appear in first-seen order; rows keep their input order.
	const groups = new Map<string, string[]>();

	for (const r of result.references) {
		const dir = dirOf(r.position.file);
		const rowParts = [
			`${baseOf(r.position.file)}:${r.position.line}:${r.position.col}`,
			r.kind,
			...(r.context !== undefined ? [r.context] : []),
			...(r.test === true ? ["(test)"] : [])
		];
		const bucket = groups.get(dir);

		if (bucket === undefined) {
			groups.set(dir, [rowParts.join("\t")]);
		} else {
			bucket.push(rowParts.join("\t"));
		}
	}

	const lines: string[] = [];

	for (const [dir, rows] of groups) {
		lines.push(`${dir === "" ? "." : dir}/  (${rows.length})`);

		for (const row of rows) {
			lines.push(`  ${row}`);
		}
	}

	const cursor = result.nextCursor !== undefined ? ` (more: cursor ${result.nextCursor})` : "";

	return `${lines.join("\n")}\n${result.total} refs${cursor}`;
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
	if (members.length === 0) {
		return "(no members)";
	}

	const used = new Set<string>();
	const rows = members.map((m) => {
		const flags = flagToken(m.exported === true, m.modifiers, used);
		const prefix = flags !== "" ? `${flags} ` : "";

		return `${tagPrefix(m.tags)}${prefix}${shortKind(m.kind)} ${m.name}\tL${m.position.line}`;
	});
	const foot = legend(used);

	return foot !== "" ? `${rows.join("\n")}\n${foot}` : rows.join("\n");
}

export function renderStatements(nodes: StatementNode[], indent = ""): string {
	if (nodes.length === 0 && indent === "") {
		return "(empty)";
	}

	const lines: string[] = [];

	for (const node of nodes) {
		const head = node.label !== undefined ? `${node.kind} ${node.label}` : node.kind;
		lines.push(`${indent}${head}\tL${node.position.line}`);

		if (node.children !== undefined && node.children.length > 0) {
			lines.push(renderStatements(node.children, `${indent}  `));
		}
	}

	return lines.join("\n");
}

function renderCallNodes(nodes: CallNode[], indent: string, lines: string[]): void {
	for (const node of nodes) {
		// Display the last name segment: drop the `file:` prefix, then the last `::` segment.
		const namePart = node.qualifiedName.slice(node.qualifiedName.indexOf(":") + 1);
		const name = splitName(namePart).pop() ?? node.qualifiedName;
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

	// qualifiedName is `file:Name`; group by file, print the name (sans file) with short kind
	// and counts under each file header. Entries are public exports, so no flag column.
	const groups = new Map<string, string[]>();

	for (const r of rows) {
		const sep = r.qualifiedName.indexOf(":");
		const file = sep === -1 ? r.qualifiedName : r.qualifiedName.slice(0, sep);
		const name = sep === -1 ? r.qualifiedName : r.qualifiedName.slice(sep + 1);
		const row = `${shortKind(r.kind)} ${name}\ttotal=${r.total} consumed=${r.consumed}`;
		const bucket = groups.get(file);

		if (bucket === undefined) {
			groups.set(file, [row]);
		} else {
			bucket.push(row);
		}
	}

	const lines: string[] = [];

	for (const [file, entries] of groups) {
		lines.push(file);

		for (const entry of entries) {
			lines.push(`  ${entry}`);
		}
	}

	return lines.join("\n");
}
