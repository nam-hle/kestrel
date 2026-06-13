import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
/**
 * Opt-in engine backed by a warm tsgo LSP subprocess (semantic ops) + the typescript
 * native parser (syntactic ops). Implements AsyncSymbolEngine; translates LSP results to
 * symantic's name-addressed contract. ts-morph `Engine` stays the sync default.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";

import ts from "typescript";

import { shortKind } from "./render.js";
import { LspClient } from "./lsp/client.js";
import { isTestFile } from "./test-file.js";
import { readRegionFrom } from "./region.js";
import { parsePageCursor } from "./cursor.js";
import { parseQualifiedName } from "./resolve.js";
import { resolveInSymbols } from "./lsp/bridge.js";
import { resolveProjectFile } from "./lsp/resolve-path.js";
import { LspSymbolKind, lspSymbolKindToName } from "./lsp/protocol.js";
import type { LspLocation, LspPosition, DocumentSymbol } from "./lsp/protocol.js";
import { lspToPosition, uriToRelative, asLocationOrNull, locationToPosition } from "./lsp/translate.js";
import {
	contextAt,
	typeRefsIn,
	classifyAt,
	buildOutline,
	parseImports,
	parseReExports,
	topLevelExports,
	functionSkeleton,
	signatureOfSource,
	declarationSourceAt,
	outlineSymbolMembers
} from "./lsp/syntactic.js";
import type {
	Member,
	CallNode,
	Position,
	Reference,
	Candidate,
	ImportInfo,
	FileOutline,
	SymbolHandle,
	UsagesResult,
	SourceResult,
	RegionResult,
	ResolveResult,
	SearchOptions,
	StatementNode,
	SymbolContext,
	UsageReportEntry,
	FindUsagesOptions,
	UsageReportOptions,
	CallHierarchyOptions,
	OutlineFunctionOptions
} from "./types.js";

export interface LspEngineOptions {
	tsConfigPath: string;
}

/** An LSP call-hierarchy item (subset we use). */
interface CallItem {
	uri: string;
	name: string;
	selectionRange: { start: LspPosition };
}

/** Invariants threaded through a call-hierarchy walk. */
interface CallWalk {
	client: LspClient;
	seen: Set<string>;
	direction: "incoming" | "outgoing";
}

/** Upper bound on files opened to warm the workspace index — guards huge repos from a slow cold start. */
const WARM_INDEX_FILE_CAP = 2000;

/** All project-relative `.ts(x)` source paths under `dir` (skips node_modules, dotfiles, .d.ts). */
function collectSources(dir: string, root: string, out: string[] = []): string[] {
	let entries;

	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}

	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name.startsWith(".")) {
			continue;
		}

		const full = `${dir}/${entry.name}`;

		if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
			out.push(full.slice(root.length + 1));
		} else if (entry.isDirectory()) {
			collectSources(full, root, out);
		}
	}

	return out;
}

/** An LSP result (array | single | null) → a clean LspLocation[], LocationLinks normalized, rangeless dropped. */
function normalizeLocations(result: unknown): LspLocation[] {
	const raw = Array.isArray(result) ? result : result === null || result === undefined ? [] : [result];

	return raw.map(asLocationOrNull).filter((loc): loc is LspLocation => loc !== null);
}

export class LspEngine {
	#client: LspClient | undefined;
	#warmed = false;
	readonly #opened = new Set<string>();
	readonly #root: string;

	public constructor(private readonly options: LspEngineOptions) {
		this.#root = resolvePath(options.tsConfigPath)
			.replace(/\\/g, "/")
			.replace(/\/[^/]*$/, "");
	}

	async #ready(): Promise<LspClient> {
		this.#client ??= new LspClient(this.#root);
		await this.#client.start();

		return this.#client;
	}

	async #open(client: LspClient, relPath: string): Promise<string> {
		const abs = this.#requireAbs(relPath);
		const text = readFileSync(abs, "utf8");

		if (!this.#opened.has(relPath)) {
			client.notify("textDocument/didOpen", {
				textDocument: { text, version: 1, languageId: "typescript", uri: pathToFileURL(abs).href }
			});
			this.#opened.add(relPath);
		}

		return text;
	}

	#uri(relPath: string): string {
		return pathToFileURL(this.#abs(relPath)).href;
	}

	/**
	 * tsgo's `workspace/symbol` only sees symbols in files the server has opened/indexed.
	 * Opening a single file indexes a small project but leaves a large one mostly blind, so
	 * a repo-wide query returns empty for symbols in unopened files (#90). Open every source
	 * (capped) to index the whole project before the first workspace query. ts-morph has no
	 * such cold-start (it loads on construct).
	 */
	async #warmIndex(client: LspClient): Promise<void> {
		if (this.#warmed) {
			return;
		}

		this.#warmed = true;
		const sources = collectSources(this.#root, this.#root).slice(0, WARM_INDEX_FILE_CAP);

		for (const rel of sources) {
			await this.#open(client, rel);
		}

		if (sources.length > 0) {
			// Give the server a beat to finish indexing before the first workspace query.
			await new Promise((res) => setTimeout(res, 200));
		}
	}

	/** Number of source files the tsconfig declares — 0 signals a non-loadable (base) tsconfig. */
	public sourceFileCount(): Promise<number> {
		const configFile = ts.readConfigFile(resolvePath(this.options.tsConfigPath), ts.sys.readFile);
		const parsed = ts.parseJsonConfigFileContent(configFile.config ?? {}, ts.sys, this.#root);

		return Promise.resolve(parsed.fileNames.length);
	}

	public async dispose(): Promise<void> {
		await this.#client?.dispose();
		this.#client = undefined;
		this.#opened.clear();
	}

	public refreshIfStale(): Promise<void> {
		// Drop the opened-set so the next access re-sends each file (re-indexing on the server).
		// Async to match AsyncSymbolEngine and leave room to await a server round-trip later.
		this.#opened.clear();

		return Promise.resolve();
	}

	/** Resolve file:Name to LSP positions via tsgo's documentSymbol tree. */
	async #hits(relPath: string, segments: string[]): Promise<{ path: string; kind: LspSymbolKind; position: LspPosition; rangeStart: LspPosition }[]> {
		const client = await this.#ready();
		await this.#open(client, relPath);
		const symbols = (await client.request("textDocument/documentSymbol", {
			textDocument: { uri: this.#uri(relPath) }
		})) as DocumentSymbol[] | null;

		return resolveInSymbols(symbols ?? [], segments).map((h) => ({ path: h.path, kind: h.kind, position: h.position, rangeStart: h.rangeStart }));
	}

	public async resolveSymbol(qualifiedName: string): Promise<ResolveResult> {
		const { file, index, segments } = parseQualifiedName(qualifiedName);
		const hits = await this.#hits(file, segments);

		if (hits.length === 0) {
			return { kind: "not-found" };
		}

		if (index !== undefined) {
			const picked = hits[index];

			return picked === undefined
				? { kind: "not-found" }
				: { kind: "symbol", symbol: { qualifiedName, position: this.#pos(file, picked.rangeStart) } };
		}

		if (hits.length > 1) {
			return {
				kind: "ambiguous",
				candidates: hits.map((h, i) => ({
					kind: "unknown",
					position: this.#pos(file, h.rangeStart),
					qualifiedName: `${file}:${h.path}${hits.filter((x) => x.path === h.path).length > 1 ? `#${i}` : ""}`
				}))
			};
		}

		const hit = hits[0]!;

		// Re-export fidelity: if documentSymbol reports the hit as a Variable (kind 13) and
		// it's a single-segment name, it may be an `export { X } from "..."` specifier.
		// Follow textDocument/definition to land on the true declaration in another file.
		if (hit.kind === LspSymbolKind.Variable && segments.length === 1) {
			const trueLoc = await this.#followDefinition(file, hit.position);

			if (trueLoc !== undefined && trueLoc.file !== file) {
				const name = segments[0]!;

				return { kind: "symbol", symbol: { position: trueLoc, qualifiedName: `${trueLoc.file}:${name}` } };
			}
		}

		return { kind: "symbol", symbol: { qualifiedName: `${file}:${hit.path}`, position: this.#pos(file, hit.rangeStart) } };
	}

	#pos(relPath: string, lsp: LspPosition): Position {
		const { col, line } = lspToPosition(lsp);

		return { col, line, file: relPath };
	}

	/** Follow textDocument/definition from a position; returns the first result, or undefined. */
	async #followDefinition(relPath: string, position: LspPosition): Promise<Position | undefined> {
		const client = await this.#ready();
		const result = await client.request("textDocument/definition", {
			position,
			textDocument: { uri: this.#uri(relPath) }
		});

		const locs = normalizeLocations(result);

		return locs.length > 0 ? locationToPosition(locs[0]!, this.#root) : undefined;
	}

	public async searchSymbol(name: string, options?: SearchOptions): Promise<Candidate[]> {
		const client = await this.#ready();
		await this.#warmIndex(client);
		const results = (await client.request("workspace/symbol", { query: name })) as { name: string; kind?: number; location: unknown }[] | null;
		const matches = (results ?? []).filter((r) => (options?.contains === true ? r.name.toLowerCase().includes(name.toLowerCase()) : r.name === name));
		const candidates: Candidate[] = [];

		for (const r of matches) {
			// workspace/symbol may carry a lazy (rangeless) location; skip those we can't place.
			const loc = asLocationOrNull(r.location);

			if (loc === null) {
				continue;
			}

			const position = locationToPosition(loc, this.#root);

			// tsgo's workspace index can reach outside the tsconfig's file set (e.g. emitted
			// lib/**/*.d.ts) — declaration outputs are build-artifact twins of source hits, skip.
			if (position.file.endsWith(".d.ts")) {
				continue;
			}

			if (options?.excludeTests === true && isTestFile(position.file)) {
				continue;
			}

			if (options?.path !== undefined && options.path !== "" && !position.file.toLowerCase().includes(options.path.toLowerCase())) {
				continue;
			}

			const kind = r.kind === undefined ? "unknown" : lspSymbolKindToName(r.kind);

			if (options?.kinds !== undefined && options.kinds.length > 0 && !options.kinds.includes(shortKind(kind))) {
				continue;
			}

			candidates.push({ kind, position, qualifiedName: `${position.file}:${r.name}` });
		}

		return candidates;
	}

	async #locations(method: string, relPath: string, segments: string[], extra: Record<string, unknown> = {}): Promise<LspLocation[]> {
		const hits = await this.#hits(relPath, segments);
		const client = await this.#ready();
		const all: LspLocation[] = [];

		for (const hit of hits) {
			const result = await client.request(method, {
				position: hit.position,
				textDocument: { uri: this.#uri(relPath) },
				...extra
			});

			all.push(...normalizeLocations(result));
		}

		return all;
	}

	public async findDefinition(symbol: SymbolHandle): Promise<SymbolHandle[]> {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const locs = await this.#locations("textDocument/definition", file, segments);

		return this.#dedupeHandles(locs);
	}

	public async symbolSource(symbol: SymbolHandle): Promise<SourceResult[]> {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const hits = await this.#hits(file, segments);
		const text = this.#read(file);

		return hits.map((hit) => ({
			qualifiedName: `${file}:${hit.path}`,
			position: this.#pos(file, hit.rangeStart),
			source: declarationSourceAt(text, hit.position) ?? ""
		}));
	}

	public async readRegion(file: string, startLine: number, endLine: number): Promise<RegionResult> {
		return readRegionFrom(this.#requireAbs(file), file, startLine, endLine);
	}

	public async symbolContext(symbol: SymbolHandle): Promise<SymbolContext> {
		const sources = await this.symbolSource(symbol);
		const first = sources[0];
		const source = first?.source ?? "";

		return {
			source,
			typeRefs: typeRefsIn(source),
			signature: signatureOfSource(source),
			position: first?.position ?? symbol.position,
			qualifiedName: first?.qualifiedName ?? symbol.qualifiedName,
			callees: await this.callHierarchy(symbol, { depth: 1, direction: "outgoing" })
		};
	}

	public async findImplementations(symbol: SymbolHandle): Promise<SymbolHandle[]> {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const locs = await this.#locations("textDocument/implementation", file, segments);

		return this.#dedupeHandles(locs);
	}

	#dedupeHandles(locs: LspLocation[]): SymbolHandle[] {
		const seen = new Set<string>();
		const handles: SymbolHandle[] = [];

		for (const loc of locs) {
			const position = locationToPosition(loc, this.#root);
			const key = `${position.file}:${position.line}:${position.col}`;

			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			// Extract the symbol name from the range (LSP impl/def results use the name token range).
			const name = this.#nameAt(position.file, loc.range);
			const qualifiedName = name !== undefined ? `${position.file}:${name}` : key;
			handles.push({ position, qualifiedName });
		}

		return handles;
	}

	/** Read a symbol name from a file at the given LSP range. Returns undefined on error. */
	#nameAt(relPath: string, range: { end: LspPosition; start: LspPosition }): string | undefined {
		try {
			const text = this.#read(relPath);
			// Split on \n then strip a trailing \r so CRLF files don't leave \r in end-of-line names.
			const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
			const line = lines[range.start.line];

			if (line === undefined) {
				return undefined;
			}

			// Name tokens are single-line; clamp the end to this line's length defensively.
			const end = range.end.line === range.start.line ? range.end.character : line.length;

			return line.slice(range.start.character, end) || undefined;
		} catch {
			return undefined;
		}
	}

	public async findUsages(symbol: SymbolHandle, options?: FindUsagesOptions): Promise<UsagesResult> {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		// includeDeclaration:true — tsgo otherwise drops import sites along with the declaration,
		// undercounting vs ts-morph. We keep imports and filter only the declaration itself,
		// keyed by the declaration's NAME-token position (tsgo returns refs at the name token).
		const hits = await this.#hits(file, segments);
		const declKeys = new Set(hits.map((h) => `${file}:${h.position.line + 1}:${h.position.character + 1}`));
		const locs = await this.#locations("textDocument/references", file, segments, { context: { includeDeclaration: true } });

		const level = options?.context ?? "none";
		const seen = new Set<string>();
		const all = [];

		for (const loc of locs) {
			const position = locationToPosition(loc, this.#root);
			const key = `${position.file}:${position.line}:${position.col}`;

			if (seen.has(key) || declKeys.has(key)) {
				continue;
			}

			seen.add(key);
			const text = readFileSync(this.#abs(position.file), "utf8");
			const kind = classifyAt(text, loc.range.start);
			const test = isTestFile(position.file);

			if (options?.excludeTests === true && test) {
				continue;
			}

			// Keep the start + text so context is computed for the page only.
			all.push({ kind, test, text, position, start: loc.range.start });
		}

		const offset = parsePageCursor(options?.cursor);
		const pageRecords = options?.limit === undefined ? all.slice(offset) : all.slice(offset, offset + options.limit);
		const nextOffset = offset + pageRecords.length;

		const references: Reference[] = pageRecords.map(({ kind, test, text, start, position }) => {
			const ctx = level === "none" ? undefined : contextAt(text, start, level);

			return { kind, test, position, ...(ctx !== undefined ? { context: ctx } : {}) };
		});

		return { references, total: all.length, nextCursor: nextOffset < all.length ? String(nextOffset) : undefined };
	}

	public async callHierarchy(symbol: SymbolHandle, options?: CallHierarchyOptions): Promise<CallNode[]> {
		const direction = options?.direction ?? "incoming";
		const depth = options?.depth ?? 2;
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const hits = await this.#hits(file, segments);
		const client = await this.#ready();
		const out: CallNode[] = [];

		for (const hit of hits) {
			const items = (await client.request("textDocument/prepareCallHierarchy", {
				position: hit.position,
				textDocument: { uri: this.#uri(file) }
			})) as CallItem[] | null;

			for (const item of items ?? []) {
				out.push(await this.#walkCalls({ client, direction, seen: new Set() }, item, depth));
			}
		}

		return out;
	}

	async #walkCalls(walk: CallWalk, item: CallItem, depth: number): Promise<CallNode> {
		const position = { file: uriToRelative(item.uri, this.#root), ...lspToPosition(item.selectionRange.start) };
		const node: CallNode = { position, calls: [], qualifiedName: `${position.file}:${item.name}` };
		const itemKey = `${item.uri}:${item.selectionRange.start.line}:${item.selectionRange.start.character}`;

		// Stop at the depth budget, or if this item was already expanded on this path (cycle).
		if (depth <= 0 || walk.seen.has(itemKey)) {
			return node;
		}

		walk.seen.add(itemKey);
		const method = walk.direction === "incoming" ? "callHierarchy/incomingCalls" : "callHierarchy/outgoingCalls";
		const calls = (await walk.client.request(method, { item })) as { to?: CallItem; from?: CallItem }[] | null;

		for (const call of calls ?? []) {
			const next = walk.direction === "incoming" ? call.from : call.to;

			if (next !== undefined) {
				node.calls.push(await this.#walkCalls(walk, next, depth - 1));
			}
		}

		return node;
	}

	// ---- syntactic ops (parser, no subprocess needed but reuse open buffers) ----

	/** Absolute, forward-slashed path for a caller-supplied (cwd-relative) file path. */
	#abs(relPath: string): string {
		return resolveProjectFile(this.#root, relPath);
	}

	/**
	 * Like #abs, but throws the same honest message as the ts-morph engine's #requireSourceFile
	 * when the file is absent — rather than letting a raw readFileSync ENOENT escape with the
	 * leaked root-joined path (#116). Used by the file-reading ops, not the warm-index probe.
	 */
	#requireAbs(relPath: string): string {
		const abs = this.#abs(relPath);

		if (!existsSync(abs)) {
			throw new Error(`file not found in project: ${relPath} (is it covered by the tsconfig, and is the path correct?)`);
		}

		return abs;
	}

	#read(relPath: string): string {
		return readFileSync(this.#requireAbs(relPath), "utf8");
	}

	// async so a #requireAbs miss surfaces as a rejection, not a sync throw — a consistent
	// contract for callers using .catch/await (#116).
	public async listImports(path: string): Promise<ImportInfo[]> {
		return parseImports(path, this.#read(path));
	}

	public async outlineFile(path: string): Promise<FileOutline> {
		return buildOutline(path, this.#read(path));
	}

	public async outlineSymbol(symbol: SymbolHandle): Promise<Member[]> {
		return this.membersByName(symbol.qualifiedName);
	}

	public async membersByName(qualifiedName: string): Promise<Member[]> {
		const { file, segments } = parseQualifiedName(qualifiedName);
		const hits = await this.#hits(file, segments);
		const text = this.#read(file);

		return hits.flatMap((hit) => outlineSymbolMembers(file, text, hit.position));
	}

	public async outlineFunction(symbol: SymbolHandle, options?: OutlineFunctionOptions): Promise<StatementNode[]> {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const hits = await this.#hits(file, segments);
		const text = this.#read(file);

		return hits.flatMap((hit) => functionSkeleton(file, text, hit.position, options?.depth ?? 1));
	}

	/**
	 * Transitive public surface: the file's own top-level declarations plus everything it
	 * re-exports (`export { X } from`, `export * from`), resolved to the true declaration —
	 * mirroring ts-morph's getExportedDeclarations. documentSymbol alone sees only own decls.
	 */
	public async publicSurface(path: string): Promise<Candidate[]> {
		const seen = new Set<string>();
		const surface: Candidate[] = [];
		await this.#collectSurface(path, surface, seen, new Set());

		return surface;
	}

	async #collectSurface(path: string, surface: Candidate[], seen: Set<string>, visitedFiles: Set<string>): Promise<void> {
		if (visitedFiles.has(path)) {
			return; // re-export cycle guard
		}

		visitedFiles.add(path);
		const text = this.#read(path);

		// Own top-level EXPORTED declarations, from the parser. documentSymbol lists ALL
		// top-level decls (imports, internals) and would massively over-count; an exported
		// namespace counts as one surface entry, not its members (mirrors getExportedDeclarations).
		for (const member of topLevelExports(path, text)) {
			const key = `${path}:${member.name}`;

			if (!seen.has(key)) {
				seen.add(key);
				surface.push({ kind: member.kind, qualifiedName: key, position: member.position });
			}
		}

		// Re-exports forwarded from other modules. Named specifiers resolve concurrently to
		// their true declaration; `export *` recurses into the target's surface.
		const reExports = parseReExports(path, text);
		const named = reExports.filter((re) => !re.star && re.name !== undefined);
		const stars = reExports.filter((re) => re.star);

		const resolved = await Promise.all(
			named.map(async (re) => {
				const target = this.#resolveModule(path, re.module);

				return target === undefined ? undefined : this.resolveSymbol(`${target}:${re.name!}`);
			})
		);

		for (const r of resolved) {
			if (r?.kind === "symbol" && !seen.has(r.symbol.qualifiedName)) {
				seen.add(r.symbol.qualifiedName);
				surface.push({ kind: "unknown", position: r.symbol.position, qualifiedName: r.symbol.qualifiedName });
			}
		}

		for (const re of stars) {
			const target = this.#resolveModule(path, re.module);

			if (target !== undefined) {
				await this.#collectSurface(target, surface, seen, visitedFiles);
			}
		}
	}

	/** Resolve a module specifier (relative to the importing file) to a root-relative .ts path. */
	#resolveModule(fromFile: string, specifier: string): string | undefined {
		if (!specifier.startsWith(".")) {
			return undefined; // bare/package specifiers are out of the project surface
		}

		// Root-relative paths are always forward-slashed; resolve POSIX-style (never the OS
		// resolver, which prepends a drive root on Windows and breaks the math).
		const fromDir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
		const segments: string[] = fromDir === "" ? [] : fromDir.split("/");

		for (const part of specifier.split("/")) {
			if (part === "" || part === ".") {
				continue;
			}

			if (part === "..") {
				segments.pop();
			} else {
				segments.push(part);
			}
		}

		const base = segments.join("/").replace(/\.js$/, "").replace(/\.ts$/, "");

		for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
			try {
				readFileSync(this.#abs(candidate), "utf8");

				return candidate;
			} catch {
				continue;
			}
		}

		return undefined;
	}

	public async usageReport(path: string, options?: UsageReportOptions): Promise<UsageReportEntry[]> {
		const surface = await this.publicSurface(path);
		const entries: UsageReportEntry[] = [];

		for (const symbol of surface) {
			const { total, references } = await this.findUsages(symbol, { excludeTests: options?.excludeTests });
			const consumed = references.filter((r) => r.kind !== "import" && r.kind !== "re-export").length;
			entries.push({ total, consumed, kind: symbol.kind, position: symbol.position, qualifiedName: symbol.qualifiedName });
		}

		return entries;
	}
}
