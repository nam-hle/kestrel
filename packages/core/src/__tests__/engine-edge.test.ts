import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

describe("engine edge cases", () => {
	test("findDefinition on a missing file returns empty", () => {
		const engine = new Engine({ tsConfigPath });
		expect(engine.findDefinition({ qualifiedName: "nope.ts:X", position: { col: 0, line: 0, file: "" } })).toEqual([]);
	});

	test("findDefinition with an out-of-range index returns empty", () => {
		const engine = new Engine({ tsConfigPath });
		expect(
			engine.findDefinition({
				qualifiedName: "src/shapes.ts:Circle#5",
				position: { col: 0, line: 0, file: "" }
			})
		).toEqual([]);
	});

	test("findUsages on a missing file returns an empty bounded result", () => {
		const engine = new Engine({ tsConfigPath });
		const result = engine.findUsages({
			qualifiedName: "nope.ts:X",
			position: { col: 0, line: 0, file: "" }
		});
		expect(result).toEqual({ total: 0, references: [], nextCursor: undefined });
	});

	test("outlineFile on a missing file returns empty buckets", () => {
		const engine = new Engine({ tsConfigPath });
		expect(engine.outlineFile("nope.ts")).toEqual({
			exports: [],
			classes: [],
			functions: [],
			interfaces: []
		});
	});

	test("outlineSymbol on a non-class/interface returns empty", () => {
		const engine = new Engine({ tsConfigPath });
		const resolved = engine.resolveSymbol("src/shapes.ts:makeCircle");

		if (resolved.kind !== "symbol") {
			throw new Error("expected symbol");
		}

		expect(engine.outlineSymbol(resolved.symbol)).toEqual([]);
	});

	test("findImplementations on a non-interface returns empty", () => {
		const engine = new Engine({ tsConfigPath });
		const resolved = engine.resolveSymbol("src/shapes.ts:Circle");

		if (resolved.kind !== "symbol") {
			throw new Error("expected symbol");
		}

		expect(engine.findImplementations(resolved.symbol)).toEqual([]);
	});

	test("refreshIfStale before any query is a no-op", () => {
		const engine = new Engine({ tsConfigPath });
		expect(() => engine.refreshIfStale()).not.toThrow();
	});
});
