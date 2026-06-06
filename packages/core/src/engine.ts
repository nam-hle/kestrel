/**
 * kestrel core engine. Holds a warm ts-morph Project, resolves symbols,
 * answers read-only queries. Transport-agnostic — knows nothing about MCP/CLI.
 * See docs/DESIGN.md Section 1 (architecture) + Section 2 (API).
 *
 * Skeleton: signatures only. No logic yet.
 */
import type {
  FileOutline,
  FindUsagesOptions,
  Member,
  OutlineFunctionOptions,
  ResolveResult,
  StatementNode,
  SymbolHandle,
  UsagesResult,
} from "./types.js";

export interface EngineOptions {
  /** Path to a tsconfig.json. */
  tsConfigPath: string;
}

const NOT_IMPLEMENTED = "not implemented";

export class Engine {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly options: EngineOptions) {}

  /** Re-read files changed out-of-band before answering. See DESIGN open-Q (staleness). */
  refreshIfStale(): void {
    throw new Error(NOT_IMPLEMENTED);
  }

  /** qualified-name -> symbol | candidates. Never silently guesses. */
  resolveSymbol(_qualifiedName: string): ResolveResult {
    throw new Error(NOT_IMPLEMENTED);
  }

  findUsages(_symbol: SymbolHandle, _options?: FindUsagesOptions): UsagesResult {
    throw new Error(NOT_IMPLEMENTED);
  }

  findImplementations(_symbol: SymbolHandle): SymbolHandle[] {
    throw new Error(NOT_IMPLEMENTED);
  }

  findDefinition(_symbol: SymbolHandle): SymbolHandle {
    throw new Error(NOT_IMPLEMENTED);
  }

  outlineFile(_path: string): FileOutline {
    throw new Error(NOT_IMPLEMENTED);
  }

  outlineSymbol(_symbol: SymbolHandle): Member[] {
    throw new Error(NOT_IMPLEMENTED);
  }

  outlineFunction(_symbol: SymbolHandle, _options?: OutlineFunctionOptions): StatementNode[] {
    throw new Error(NOT_IMPLEMENTED);
  }
}
