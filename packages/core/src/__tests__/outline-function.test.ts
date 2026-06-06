import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";
import type { SymbolHandle } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

function resolve(engine: Engine, name: string): SymbolHandle {
	const result = engine.resolveSymbol(name);

	if (result.kind !== "symbol") {
		throw new Error(`expected symbol, got ${result.kind}`);
	}

	return result.symbol;
}

describe("outlineFunction", () => {
	test("returns the top-level statement skeleton of a function body", () => {
		const engine = new Engine({ tsConfigPath });
		const symbol = resolve(engine, "src/consumer.ts:totalArea");

		const nodes = engine.outlineFunction(symbol);

		const kinds = nodes.map((n) => n.kind);
		expect(kinds).toContain("VariableStatement");
		expect(kinds).toContain("ForStatement");
		expect(kinds).toContain("ReturnStatement");
	});

	test("nests child statements up to the requested depth", () => {
		const engine = new Engine({ tsConfigPath });
		const symbol = resolve(engine, "src/consumer.ts:totalArea");

		const flat = engine.outlineFunction(symbol, { depth: 1 });
		const nested = engine.outlineFunction(symbol, { depth: 2 });

		const forFlat = flat.find((n) => n.kind === "ForStatement");
		const forNested = nested.find((n) => n.kind === "ForStatement");

		expect(forFlat?.children).toBeUndefined();
		expect(forNested?.children?.length).toBeGreaterThan(0);
	});
});
