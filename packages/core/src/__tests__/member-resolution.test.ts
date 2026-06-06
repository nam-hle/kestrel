import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

describe("member resolution", () => {
	test("resolves an interface member by dotted path", () => {
		const engine = new Engine({ tsConfigPath });

		const result = engine.resolveSymbol("src/shapes.ts:Shape.area");

		expect(result.kind).toBe("symbol");

		if (result.kind !== "symbol") {
			return;
		}

		expect(result.symbol.qualifiedName).toBe("src/shapes.ts:Shape.area");
		expect(result.symbol.position.line).toBe(2);
	});

	test("resolves a class method by dotted path", () => {
		const engine = new Engine({ tsConfigPath });

		const result = engine.resolveSymbol("src/shapes.ts:Circle.area");

		expect(result.kind).toBe("symbol");

		if (result.kind !== "symbol") {
			return;
		}

		expect(result.symbol.position.line).toBe(7);
	});

	test("search finds same-named members across types as candidates", () => {
		const engine = new Engine({ tsConfigPath });

		const hits = engine.searchSymbol("area").map((h) => h.qualifiedName);

		expect(hits).toContain("src/shapes.ts:Shape.area");
		expect(hits).toContain("src/shapes.ts:Circle.area");
	});
});
