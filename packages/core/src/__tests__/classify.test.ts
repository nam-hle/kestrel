import { describe, expect, test } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { classifyReference } from "../usages.js";
import type { ReferenceKind } from "../index.js";

/** Build a one-file project and return identifiers matching `name`. */
function identifiers(code: string, name: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("t.ts", code);
  return sf
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((id) => id.getText() === name);
}

function kindsOf(code: string, name: string): ReferenceKind[] {
  return identifiers(code, name).map((id) => classifyReference(id));
}

describe("classifyReference", () => {
  test("named import specifier -> import", () => {
    expect(kindsOf(`import { foo } from "./m.js"; foo();`, "foo")).toContain("import");
  });

  test("default/namespace import clause -> import", () => {
    expect(kindsOf(`import * as ns from "./m.js"; ns.x;`, "ns")).toContain("import");
  });

  test("call target -> call", () => {
    expect(kindsOf(`declare function foo(): void; foo();`, "foo")).toContain("call");
  });

  test("new target -> call", () => {
    expect(kindsOf(`class Foo {} new Foo();`, "Foo")).toContain("call");
  });

  test("type annotation -> type-ref", () => {
    expect(kindsOf(`interface Foo {} const a: Foo = {} as Foo;`, "Foo")).toContain("type-ref");
  });

  test("assignment LHS -> write", () => {
    expect(kindsOf(`let x = 1; x = 2;`, "x")).toContain("write");
  });

  test("plain reference -> read", () => {
    expect(kindsOf(`let x = 1; const y = x + 1;`, "x")).toContain("read");
  });
});
