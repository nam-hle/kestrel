/**
 * Opt-in engine backed by a warm tsgo LSP subprocess (semantic ops) + the typescript
 * native parser (syntactic ops). Implements AsyncSymbolEngine; translates LSP results to
 * kestrel's name-addressed contract. ts-morph `Engine` stays the sync default.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

import { LspClient } from "./lsp/client.js";
import { parseQualifiedName } from "./resolve.js";
import { LspSymbolKind } from "./lsp/protocol.js";
import { resolveInSymbols } from "./lsp/bridge.js";
import type { LspLocation, LspPosition, DocumentSymbol } from "./lsp/protocol.js";
import { lspToPosition, uriToRelative, locationToPosition } from "./lsp/translate.js";
import { classifyAt, buildOutline, parseImports, functionSkeleton, outlineSymbolMembers } from "./lsp/syntactic.js";
import type {
	Member,
	CallNode,
	Position,
	Candidate,
	ImportInfo,
	FileOutline,
	SymbolHandle,
	UsagesResult,
	ResolveResult,
	SearchOptions,
	StatementNode,
	UsageReportEntry,
	FindUsagesOptions,
	UsageReportOptions,
	CallHierarchyOptions,
	OutlineFunctionOptions
} from "./types.js";

export interface LspEngineOptions {
	tsConfigPath: string;
}

const isTestFile = (file: string): boolean => /(\.test\.|\.spec\.|\/__tests__\/|\/e2e\/)/.test(file);

export class LspEngine {
	#client: LspClient | undefined;
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
		const abs = `${this.#root}/${relPath}`;
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
		return pathToFileURL(`${this.#root}/${relPath}`).href;
	}

	public async dispose(): Promise<void> {
		await this.#client?.dispose();
		this.#client = undefined;
		this.#opened.clear();
	}

	public refreshIfStale(): void {
		this.#opened.clear(); // next access re-opens with fresh text
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
		const result = (await client.request("textDocument/definition", {
			position,
			textDocument: { uri: this.#uri(relPath) }
		})) as LspLocation[] | LspLocation | null;

		const locs: LspLocation[] = Array.isArray(result) ? result : result !== null ? [result] : [];

		return locs.length > 0 ? locationToPosition(locs[0]!, this.#root) : undefined;
	}

	public async searchSymbol(name: string, options?: SearchOptions): Promise<Candidate[]> {
		const client = await this.#ready();
		const results = (await client.request("workspace/symbol", { query: name })) as { name: string; kind: number; location: LspLocation }[] | null;
		const matches = (results ?? []).filter((r) => (options?.contains === true ? r.name.toLowerCase().includes(name.toLowerCase()) : r.name === name));

		return matches.map((r) => {
			const position = locationToPosition(r.location, this.#root);

			return { position, kind: "unknown", qualifiedName: `${position.file}:${r.name}` };
		});
	}

	async #locations(method: string, relPath: string, segments: string[], extra: Record<string, unknown> = {}): Promise<LspLocation[]> {
		const hits = await this.#hits(relPath, segments);
		const client = await this.#ready();
		const all: LspLocation[] = [];

		for (const hit of hits) {
			const result = (await client.request(method, {
				position: hit.position,
				textDocument: { uri: this.#uri(relPath) },
				...extra
			})) as LspLocation[] | LspLocation | null;

			if (Array.isArray(result)) {
				all.push(...result);
			} else if (result !== null) {
				all.push(result as LspLocation);
			}
		}

		return all;
	}

	public async findDefinition(symbol: SymbolHandle): Promise<SymbolHandle[]> {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const locs = await this.#locations("textDocument/definition", file, segments);

		return this.#dedupeHandles(locs);
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
			const lines = text.split("\n");
			const line = lines[range.start.line];

			if (line === undefined) {
				return undefined;
			}

			return line.slice(range.start.character, range.end.character) || undefined;
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

		const seen = new Set<string>();
		const all = [];

		for (const loc of locs) {
			const position = locationToPosition(loc, this.#root);
			const key = `${position.file}:${position.line}:${position.col}`;

			if (seen.has(key) || declKeys.has(key)) {
				continue;
			}

			seen.add(key);
			const text = readFileSync(`${this.#root}/${position.file}`, "utf8");
			const kind = classifyAt(text, loc.range.start);
			const test = isTestFile(position.file);

			if (options?.excludeTests === true && test) {
				continue;
			}

			all.push({ kind, test, position });
		}

		const offset = options?.cursor ? Number(options.cursor) : 0;
		const page = options?.limit === undefined ? all.slice(offset) : all.slice(offset, offset + options.limit);
		const nextOffset = offset + page.length;

		return { references: page, total: all.length, nextCursor: nextOffset < all.length ? String(nextOffset) : undefined };
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
			})) as { uri: string; name: string; selectionRange: { start: LspPosition } }[] | null;

			for (const item of items ?? []) {
				out.push(await this.#walkCalls(client, item, direction, depth));
			}
		}

		return out;
	}

	async #walkCalls(
		client: LspClient,
		item: { uri: string; name: string; selectionRange: { start: LspPosition } },
		direction: "incoming" | "outgoing",
		depth: number
	): Promise<CallNode> {
		const position = { file: uriToRelative(item.uri, this.#root), ...lspToPosition(item.selectionRange.start) };
		const node: CallNode = { position, calls: [], qualifiedName: `${position.file}:${item.name}` };

		if (depth <= 0) {
			return node;
		}

		const method = direction === "incoming" ? "callHierarchy/incomingCalls" : "callHierarchy/outgoingCalls";
		const calls = (await client.request(method, { item })) as { to?: typeof item; from?: typeof item }[] | null;

		for (const call of calls ?? []) {
			const next = direction === "incoming" ? call.from : call.to;

			if (next !== undefined) {
				node.calls.push(await this.#walkCalls(client, next, direction, depth - 1));
			}
		}

		return node;
	}

	// ---- syntactic ops (parser, no subprocess needed but reuse open buffers) ----

	#read(relPath: string): string {
		return readFileSync(`${this.#root}/${relPath}`, "utf8");
	}

	public listImports(path: string): Promise<ImportInfo[]> {
		return Promise.resolve(parseImports(path, this.#read(path)));
	}

	public outlineFile(path: string): Promise<FileOutline> {
		return Promise.resolve(buildOutline(path, this.#read(path)));
	}

	public async outlineSymbol(symbol: SymbolHandle): Promise<Member[]> {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
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

	/** export * + re-export expansion: parse the entry's exports, resolve each via definition. */
	public async publicSurface(path: string): Promise<Candidate[]> {
		const client = await this.#ready();
		await this.#open(client, path);
		const symbols = (await client.request("textDocument/documentSymbol", { textDocument: { uri: this.#uri(path) } })) as DocumentSymbol[] | null;
		const seen = new Set<string>();
		const surface: Candidate[] = [];

		for (const sym of symbols ?? []) {
			const position = this.#pos(path, sym.range.start);
			const key = `${position.file}:${sym.name}`;

			if (!seen.has(key)) {
				seen.add(key);
				surface.push({ position, kind: "unknown", qualifiedName: key });
			}
		}

		return surface;
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
