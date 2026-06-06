/**
 * Deterministic structural outline of a file. AST walk, no LLM.
 * See docs/VISION.md (outline ops), docs/DESIGN.md Section 2.
 */
import { Node } from "ts-morph";
import type { SourceFile, Statement } from "ts-morph";
import { position } from "./resolve.js";
import type { FileOutline, Member, StatementNode } from "./types.js";

/** Single-line signature: declaration text up to its body (or the whole line). */
function signatureOf(node: Node): string {
  const text = node.getText();
  const brace = text.indexOf("{");
  const head = brace === -1 ? text : text.slice(0, brace);
  return head.trim().replace(/\s+/g, " ");
}

function toMember(node: Node, name: string): Member {
  return {
    name,
    kind: node.getKindName(),
    signature: signatureOf(node),
    position: position(node),
  };
}

/** Direct child statements of a statement (into its block/body), one level down. */
function childStatements(node: Node): Statement[] {
  const result: Statement[] = [];
  node.forEachChild((child) => {
    if (Node.isBlock(child)) result.push(...child.getStatements());
    else if (Node.isStatement(child)) result.push(child);
  });
  return result;
}

function buildStatementNode(stmt: Node, depth: number): StatementNode {
  const node: StatementNode = { kind: stmt.getKindName(), position: position(stmt) };
  if (depth > 1) {
    const children = childStatements(stmt).map((child) => buildStatementNode(child, depth - 1));
    if (children.length > 0) node.children = children;
  }
  return node;
}

/** Deterministic statement-level skeleton of a function body. */
export function buildFunctionOutline(decl: Node, depth: number): StatementNode[] {
  const body = decl.forEachChildAsArray().find((c) => Node.isBlock(c));
  if (!body || !Node.isBlock(body)) return [];
  return body.getStatements().map((stmt) => buildStatementNode(stmt, depth));
}

/** Members of a class / interface declaration. */
export function buildSymbolOutline(decl: Node): Member[] {
  const members: Node[] = [];
  if (Node.isClassDeclaration(decl)) members.push(...decl.getMembers());
  else if (Node.isInterfaceDeclaration(decl)) members.push(...decl.getMembers());
  else return [];

  return members.map((member) => {
    const name = Node.hasName(member) ? (member.getName() ?? "") : member.getKindName();
    return toMember(member, name);
  });
}

export function buildFileOutline(sourceFile: SourceFile): FileOutline {
  const outline: FileOutline = { exports: [], classes: [], interfaces: [], functions: [] };

  for (const stmt of sourceFile.getStatements()) {
    if (!Node.hasName(stmt)) continue;
    const name = stmt.getName();
    if (name === undefined) continue;
    const member = toMember(stmt, name);

    if (Node.isClassDeclaration(stmt)) outline.classes.push(member);
    else if (Node.isInterfaceDeclaration(stmt)) outline.interfaces.push(member);
    else if (Node.isFunctionDeclaration(stmt)) outline.functions.push(member);

    if (Node.isExportable(stmt) && stmt.isExported()) outline.exports.push(member);
  }

  return outline;
}
