import { describe, expect, test } from "vitest";
import { parseQualifiedName } from "../resolve.js";

describe("parseQualifiedName", () => {
  test("parses file:name", () => {
    expect(parseQualifiedName("src/a.ts:Foo")).toEqual({ file: "src/a.ts", name: "Foo" });
  });

  test("parses file:name#index", () => {
    expect(parseQualifiedName("src/a.ts:Foo#2")).toEqual({
      file: "src/a.ts",
      name: "Foo",
      index: 2,
    });
  });

  test("throws when the separator is missing", () => {
    expect(() => parseQualifiedName("noseparator")).toThrow(/expected file:name/);
  });

  test("throws on a non-integer index", () => {
    expect(() => parseQualifiedName("src/a.ts:Foo#x")).toThrow(/invalid index/);
  });

  test("throws on a negative index", () => {
    expect(() => parseQualifiedName("src/a.ts:Foo#-1")).toThrow(/invalid index/);
  });
});
