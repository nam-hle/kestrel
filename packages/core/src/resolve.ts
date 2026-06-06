/**
 * Symbol resolution — qualified-name parsing and name-based declaration lookup.
 * v1 grammar: name-only per file (`relPath:name`, optional `#index` for disambiguation).
 * See docs/DESIGN.md open-Q (symbol resolution).
 */
import { Node } from "ts-morph";
import type { SourceFile } from "ts-morph";
import type { Position, SymbolHandle } from "./types.js";

export interface ParsedName {
  file: string;
  name: string;
  /** Zero-based index into same-name declarations, when disambiguated (`name#1`). */
  index?: number;
}

/** Parse `relPath:name` or `relPath:name#index`. */
export function parseQualifiedName(qualifiedName: string): ParsedName {
  const sep = qualifiedName.lastIndexOf(":");
  if (sep === -1) {
    throw new Error(`invalid qualified name (expected file:name): ${qualifiedName}`);
  }
  const file = qualifiedName.slice(0, sep);
  const rest = qualifiedName.slice(sep + 1);

  const hash = rest.lastIndexOf("#");
  if (hash === -1) return { file, name: rest };

  const name = rest.slice(0, hash);
  const index = Number(rest.slice(hash + 1));
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`invalid index in qualified name: ${qualifiedName}`);
  }
  return { file, name, index };
}

/** Find top-level declarations in a file matching a bare name. */
export function findNamedDeclarations(sourceFile: SourceFile, name: string): Node[] {
  const matches: Node[] = [];
  for (const stmt of sourceFile.getStatements()) {
    if (Node.isVariableStatement(stmt)) {
      for (const decl of stmt.getDeclarations()) {
        if (decl.getName() === name) matches.push(decl);
      }
    } else if (Node.hasName(stmt) && stmt.getName() === name) {
      matches.push(stmt);
    }
  }
  return matches;
}

export function position(node: Node): Position {
  const start = node.getStart();
  const sourceFile = node.getSourceFile();
  const { line, column } = sourceFile.getLineAndColumnAtPos(start);
  return { file: sourceFile.getFilePath(), line, col: column };
}

/** Build a SymbolHandle for a declaration, optionally with a disambiguation index. */
export function declarationToHandle(
  decl: Node,
  file: string,
  name: string,
  index?: number,
): SymbolHandle {
  const qualifiedName = index === undefined ? `${file}:${name}` : `${file}:${name}#${index}`;
  return { qualifiedName, position: position(decl) };
}
