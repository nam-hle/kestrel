/**
 * kestrel core engine. Holds a warm ts-morph Project, resolves symbols,
 * answers read-only queries. Transport-agnostic — knows nothing about MCP/CLI.
 * See docs/DESIGN.md Section 1 (architecture) + Section 2 (API).
 */
import { resolve as resolvePath } from "node:path";

import { Node, Project } from "ts-morph";
import type { SourceFile } from "ts-morph";

import { classifyReference } from "./usages.js";
import { buildFileOutline, buildSymbolOutline, buildFunctionOutline } from "./outline.js";
import { position, parseQualifiedName, declarationToHandle, findNamedDeclarations } from "./resolve.js";
import type {
	Member,
	FileOutline,
	SymbolHandle,
	UsagesResult,
	ResolveResult,
	StatementNode,
	FindUsagesOptions,
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

		const decls = findNamedDeclarations(sourceFile, segments);

		if (decls.length === 0) {
			return { kind: "not-found" };
		}

		if (index !== undefined) {
			const picked = decls[index];

			if (!picked) {
				return { kind: "not-found" };
			}

			return { kind: "symbol", symbol: declarationToHandle(picked, file, index) };
		}

		if (decls.length > 1) {
			return {
				kind: "ambiguous",
				candidates: decls.map((decl, i) => {
					// Distinct dotted paths self-disambiguate; only same-path collisions need #index.
					const samePathCount = decls.filter((d) => d.path === decl.path).length;
					const handle = declarationToHandle(decl, file, samePathCount > 1 ? i : undefined);

					return {
						position: handle.position,
						kind: decl.node.getKindName(),
						qualifiedName: handle.qualifiedName
					};
				})
			};
		}

		return { kind: "symbol", symbol: declarationToHandle(decls[0]!, file) };
	}

	/** Resolve a handle back to its declaration node(s). */
	#declarationsFor(symbol: SymbolHandle): Node[] {
		const { file, index, segments } = parseQualifiedName(symbol.qualifiedName);
		const sourceFile = this.#getSourceFile(file);

		if (!sourceFile) {
			return [];
		}

		const decls = findNamedDeclarations(sourceFile, segments);

		if (index !== undefined) {
			const picked = decls[index];

			return picked ? [picked.node] : [];
		}

		return decls.map((d) => d.node);
	}

	/** All references to a symbol, classified by kind. Bounded by `limit`/`cursor`. */
	public findUsages(symbol: SymbolHandle, options?: FindUsagesOptions): UsagesResult {
		const decls = this.#declarationsFor(symbol);

		const seen = new Set<string>();
		const all = decls
			.filter((decl) => Node.isReferenceFindable(decl))
			.flatMap((decl) => decl.findReferencesAsNodes())
			.map((node) => ({ position: position(node), kind: classifyReference(node) }))
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

	/** Relative path of a source file, as used in qualified names (relative to the tsconfig dir). */
	#relPath(absPath: string): string {
		// ts-morph normalizes paths to forward slashes; normalize the tsconfig path too
		// so this works on Windows (where fileURLToPath yields backslashes).
		const normalized = absPath.replace(/\\/g, "/");
		// Resolve the tsconfig path to absolute (callers may pass it relative to cwd)
		// so the base matches ts-morph's absolute file paths.
		const base = resolvePath(this.options.tsConfigPath)
			.replace(/\\/g, "/")
			.replace(/\/[^/]*$/, "");

		if (normalized.startsWith(base)) {
			return normalized.slice(base.length).replace(/^\//, "");
		}

		return normalized;
	}

	/** Implementors of an interface / abstract. */
	public findImplementations(symbol: SymbolHandle): SymbolHandle[] {
		const decls = this.#declarationsFor(symbol);

		const seen = new Set<string>();
		const handles: SymbolHandle[] = [];

		for (const decl of decls) {
			if (!Node.isInterfaceDeclaration(decl)) {
				continue;
			}

			for (const impl of decl.getImplementations()) {
				const node = impl.getNode();
				const name = node.getText();
				const pos = position(node);
				const qualifiedName = `${this.#relPath(pos.file)}:${name}`;

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

		return this.#declarationsFor(symbol).map((node) => declarationToHandle({ node, path }, file));
	}

	/** Structural "table of contents" for a file. Deterministic AST walk. */
	public outlineFile(path: string): FileOutline {
		const sourceFile = this.#getSourceFile(path);

		if (!sourceFile) {
			return { exports: [], classes: [], functions: [], interfaces: [] };
		}

		return buildFileOutline(sourceFile);
	}

	/** Members of a class / interface / namespace. Deterministic AST walk. */
	public outlineSymbol(symbol: SymbolHandle): Member[] {
		const decls = this.#declarationsFor(symbol);

		return decls.flatMap((decl) => buildSymbolOutline(decl));
	}

	/** Statement-level skeleton of a function body. `depth` controls nesting (default 1). */
	public outlineFunction(symbol: SymbolHandle, options?: OutlineFunctionOptions): StatementNode[] {
		const depth = options?.depth ?? 1;
		const decls = this.#declarationsFor(symbol);

		return decls.flatMap((decl) => buildFunctionOutline(decl, depth));
	}
}
