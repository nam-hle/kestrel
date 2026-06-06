import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine, renderFileOutline } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

function render(file: string): string {
	return renderFileOutline(file, new Engine({ tsConfigPath }).outlineFile(file));
}

describe("renderFileOutline (compact tree)", () => {
	test("namespaced file factors prefixes into a tree", () => {
		expect(render("src/nested.ts")).toMatchInlineSnapshot(`
			"src/nested.ts:
			  namespace Model
			    namespace Inner
			      interface Node  L7 [x]
			    interface Node  L2 [x]
			  namespace Runtime
			    interface Node  L14 [x]"
		`);
	});

	test("consumer file: declarations only, no function-body locals", () => {
		expect(render("src/consumer.ts")).toMatchInlineSnapshot(`
			"src/consumer.ts:
			  fn totalArea  L3 [x]
			  const averageArea  L12 [x]
			  class AreaService  L20 [x]
			  interface AreaCalculators  L27 [x]
			  fn makeCalculators  L32 [x]
			  fn makeSelectors  L41 [x]"
		`);
	});

	test("barrel file lists re-exports", () => {
		expect(render("src/barrel.ts")).toMatchInlineSnapshot(`
			"src/barrel.ts:
			  re-exports:
			    Circle
			    makeCircle
			    Shape (type)
			    * from ./square.js"
		`);
	});
});
