import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

describe("searchSymbol", () => {
	test("finds every declaration of a name across the repo", () => {
		const engine = new Engine({ tsConfigPath });

		const hits = engine.searchSymbol("Node");

		const names = hits.map((h) => h.qualifiedName);
		expect(names).toContain("src/nested.ts:Model.Node");
		expect(names).toContain("src/nested.ts:Model.Inner.Node");
		expect(names).toContain("src/nested.ts:Runtime.Node");
	});

	test("matches the exact name, not substrings, by default", () => {
		const engine = new Engine({ tsConfigPath });

		const hits = engine.searchSymbol("Circle");

		expect(hits.map((h) => h.qualifiedName)).toEqual(["src/shapes.ts:Circle"]);
	});

	test("matches substrings when contains is set", () => {
		const engine = new Engine({ tsConfigPath });

		const exact = engine.searchSymbol("Make");
		const contains = engine.searchSymbol("Make", { contains: true });

		expect(exact).toHaveLength(0);
		expect(contains.map((h) => h.qualifiedName)).toContain("src/shapes.ts:makeCircle");
	});

	test("returns an empty list when nothing matches", () => {
		const engine = new Engine({ tsConfigPath });

		expect(engine.searchSymbol("DoesNotExistAnywhere")).toEqual([]);
	});
});
