/**
 * kestrel core engine. Holds a warm ts-morph Project, resolves symbols,
 * answers read-only queries. Transport-agnostic — knows nothing about MCP/CLI.
 * See docs/DESIGN.md Section 1 (architecture) + Section 2 (API).
 */
import { resolve as resolvePath } from "node:path";

import { Node, Project } from "ts-morph";
import type { SourceFile } from "ts-morph";

import { classifyReference } from "./usages.js";
import { buildCallHierarchy } from "./call-hierarchy.js";
import { buildFileOutline, buildSymbolOutline, buildFunctionOutline } from "./outline.js";
import {
	position,
	toRelative,
	nearestNames,
	allDeclarations,
	parseQualifiedName,
	declarationToHandle,
	findDeclarationsThroughReExports
} from "./resolve.js";
import type {
	Member,
	CallNode,
	Candidate,
	ImportInfo,
	FileOutline,
	SymbolHandle,
	UsagesResult,
	ResolveResult,
	SearchOptions,
	StatementNode,
	FindUsagesOptions,
	CallHierarchyOptions,
	OutlineFunctionOptions
} from "./types.js";

export interface EngineOptions {
	/** Path to a tsconfig.json. */
	tsConfigPath: string;
}

export class Engine {
	#project: Project | undefined;

	public constructor(private readonly options: EngineOptions) {}

	/** Lazily load + warm the ts-morph Project on first use. */
	#getProject(): Project {
		this.#project ??= new Project({ tsConfigFilePath: this.options.tsConfigPath });

		return this.#project;
	}

	#getSourceFile(relPath: string): SourceFile | undefined {
		const project = this.#getProject();

		return project.getSourceFile(relPath) ?? project.getSourceFiles().find((sf) => sf.getFilePath().endsWith(relPath));
	}

	/** Like #getSourceFile but throws a clear error when the file isn't in the project. */
	#requireSourceFile(relPath: string): SourceFile {
		const sourceFile = this.#getSourceFile(relPath);

		if (!sourceFile) {
			throw new Error(`file not found in project: ${relPath} (is it covered by the tsconfig, and is the path correct?)`);
		}

		return sourceFile;
	}

	/** The tsconfig directory, absolute + forward-slashed — the base for relative paths. */
	#baseDir(): string {
		return resolvePath(this.options.tsConfigPath)
			.replace(/\\/g, "/")
			.replace(/\/[^/]*$/, "");
	}

	/** Re-read files changed out-of-band before answering. See DESIGN open-Q (staleness). */
	public refreshIfStale(): void {
		if (this.#project === undefined) {
			return;
		}

		for (const sourceFile of this.#project.getSourceFiles()) {
			sourceFile.refreshFromFileSystemSync();
		}
	}

	/**
	 * qualified-name -> symbol | candidates. `relPath:name`, where name is a dotted
	 * path into nested namespaces (`Model.Inner.Node`); a bare segment matches at any
	 * depth. Ambiguous -> candidates (caller disambiguates by dotted path or `#index`).
	 * Never silently guesses.
	 */
	public resolveSymbol(qualifiedName: string): ResolveResult {
		const { file, index, segments } = parseQualifiedName(qualifiedName);
		const sourceFile = this.#getSourceFile(file);

		if (!sourceFile) {
			return { kind: "not-found" };
		}

		const decls = findDeclarationsThroughReExports(sourceFile, segments);

		if (decls.length === 0) {
			const suggestions = nearestNames(sourceFile, segments[segments.length - 1]!);

			return suggestions.length > 0 ? { suggestions, kind: "not-found" } : { kind: "not-found" };
		}

		const base = this.#baseDir();

		if (index !== undefined) {
			const picked = decls[index];

			if (!picked) {
				return { kind: "not-found" };
			}

			return { kind: "symbol", symbol: declarationToHandle(picked, file, base, index) };
		}

		if (decls.length > 1) {
			return {
				kind: "ambiguous",
				candidates: decls.map((decl, i) => {
					// Distinct dotted paths self-disambiguate; only same-path collisions need #index.
					const samePathCount = decls.filter((d) => d.path === decl.path).length;
					const handle = declarationToHandle(decl, file, base, samePathCount > 1 ? i : undefined);

					return {
						position: handle.position,
						kind: decl.node.getKindName(),
						qualifiedName: handle.qualifiedName
					};
				})
			};
		}

		return { kind: "symbol", symbol: declarationToHandle(decls[0]!, file, base) };
	}

	/**
	 * Repo-wide search for declarations named `name`, across all source files and
	 * namespace depths. Exact last-segment match by default; substring (case-insensitive)
	 * with `contains`. Returns candidates the caller can target for refs/def.
	 */
	public searchSymbol(name: string, options?: SearchOptions): Candidate[] {
		const matches = (declName: string): boolean =>
			options?.contains === true ? declName.toLowerCase().includes(name.toLowerCase()) : declName === name;

		const candidates: Candidate[] = [];
		const base = this.#baseDir();

		for (const sourceFile of this.#getProject().getSourceFiles()) {
			const rel = toRelative(sourceFile.getFilePath(), base);

			for (const decl of allDeclarations(sourceFile)) {
				const segments = decl.path.split(".");

				if (!matches(segments[segments.length - 1]!)) {
					continue;
				}

				candidates.push({
					kind: decl.node.getKindName(),
					position: position(decl.node, base),
					qualifiedName: `${rel}:${decl.path}`
				});
			}
		}

		return candidates;
	}

	/** Resolve a handle back to its declaration node(s). */
	#declarationsFor(symbol: SymbolHandle): Node[] {
		const { file, index, segments } = parseQualifiedName(symbol.qualifiedName);
		const sourceFile = this.#getSourceFile(file);

		if (!sourceFile) {
			return [];
		}

		const decls = findDeclarationsThroughReExports(sourceFile, segments);

		if (index !== undefined) {
			const picked = decls[index];

			return picked ? [picked.node] : [];
		}

		return decls.map((d) => d.node);
	}

	/** All references to a symbol, classified by kind. Bounded by `limit`/`cursor`. */
	public findUsages(symbol: SymbolHandle, options?: FindUsagesOptions): UsagesResult {
		const decls = this.#declarationsFor(symbol);
		const base = this.#baseDir();

		const seen = new Set<string>();
		const all = decls
			.filter((decl) => Node.isReferenceFindable(decl))
			.flatMap((decl) => decl.findReferencesAsNodes())
			.map((node) => ({ kind: classifyReference(node), position: position(node, base) }))
			.filter((ref) => {
				const key = `${ref.position.file}:${ref.position.line}:${ref.position.col}`;

				if (seen.has(key)) {
					return false;
				}

				seen.add(key);

				return true;
			});

		const offset = options?.cursor ? Number(options.cursor) : 0;
		const limit = options?.limit;
		const page = limit === undefined ? all.slice(offset) : all.slice(offset, offset + limit);
		const nextOffset = offset + page.length;
		const nextCursor = nextOffset < all.length ? String(nextOffset) : undefined;

		return { nextCursor, references: page, total: all.length };
	}

	/** Callers (incoming) or callees (outgoing) of a symbol, walked to a bounded depth. */
	public callHierarchy(symbol: SymbolHandle, options?: CallHierarchyOptions): CallNode[] {
		const direction = options?.direction ?? "incoming";
		const depth = options?.depth ?? 2;
		const base = this.#baseDir();

		return this.#declarationsFor(symbol).flatMap((decl) => buildCallHierarchy(decl, direction, depth, base));
	}

	/** Implementors of an interface / abstract. */
	public findImplementations(symbol: SymbolHandle): SymbolHandle[] {
		const decls = this.#declarationsFor(symbol);
		const base = this.#baseDir();

		const seen = new Set<string>();
		const handles: SymbolHandle[] = [];

		for (const decl of decls) {
			if (!Node.isInterfaceDeclaration(decl)) {
				continue;
			}

			for (const impl of decl.getImplementations()) {
				const node = impl.getNode();
				const name = node.getText();
				const pos = position(node, base);
				const qualifiedName = `${pos.file}:${name}`;

				if (seen.has(qualifiedName)) {
					continue;
				}

				seen.add(qualifiedName);
				handles.push({ qualifiedName, position: pos });
			}
		}

		return handles;
	}

	/** All declaration sites of a resolved symbol (handles declaration merging / overloads). */
	public findDefinition(symbol: SymbolHandle): SymbolHandle[] {
		const { file, segments } = parseQualifiedName(symbol.qualifiedName);
		const path = segments.join(".");
		const base = this.#baseDir();

		return this.#declarationsFor(symbol).map((node) => declarationToHandle({ node, path }, file, base));
	}

	/** Structural "table of contents" for a file. Deterministic AST walk. */
	public outlineFile(path: string): FileOutline {
		return buildFileOutline(this.#requireSourceFile(path), this.#baseDir());
	}

	/**
	 * The transitive public surface of an entry file: resolves `export *` and re-export
	 * chains to the concrete exported symbols, each pointed at its true declaration.
	 */
	public publicSurface(path: string): Candidate[] {
		const sourceFile = this.#requireSourceFile(path);
		const base = this.#baseDir();
		const seen = new Set<string>();
		const surface: Candidate[] = [];

		for (const [name, declarations] of sourceFile.getExportedDeclarations()) {
			for (const decl of declarations) {
				const pos = position(decl, base);
				const key = `${pos.file}:${name}`;

				if (seen.has(key)) {
					continue;
				}

				seen.add(key);
				surface.push({ position: pos, qualifiedName: key, kind: decl.getKindName() });
			}
		}

		return surface;
	}

	/** The import statements of a file — module wiring, deterministic. */
	public listImports(path: string): ImportInfo[] {
		const sourceFile = this.#requireSourceFile(path);

		const base = this.#baseDir();

		return sourceFile.getImportDeclarations().map((decl) => {
			const namespace = decl.getNamespaceImport()?.getText();
			const defaultImport = decl.getDefaultImport()?.getText();

			return {
				module: decl.getModuleSpecifierValue(),
				named: decl.getNamedImports().map((n) => n.getName()),
				...(defaultImport !== undefined ? { default: defaultImport } : {}),
				...(namespace !== undefined ? { namespace } : {}),
				position: position(decl, base)
			};
		});
	}

	/** Members of a class / interface / namespace. Deterministic AST walk. */
	public outlineSymbol(symbol: SymbolHandle): Member[] {
		const base = this.#baseDir();

		return this.#declarationsFor(symbol).flatMap((decl) => buildSymbolOutline(decl, base));
	}

	/** Statement-level skeleton of a function body. `depth` controls nesting (default 1). */
	public outlineFunction(symbol: SymbolHandle, options?: OutlineFunctionOptions): StatementNode[] {
		const depth = options?.depth ?? 1;
		const base = this.#baseDir();

		return this.#declarationsFor(symbol).flatMap((decl) => buildFunctionOutline(decl, depth, base));
	}
}
