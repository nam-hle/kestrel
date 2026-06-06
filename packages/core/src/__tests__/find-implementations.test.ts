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

describe("findImplementations", () => {
	test("finds all classes implementing an interface", () => {
		const engine = new Engine({ tsConfigPath });
		const shape = resolve(engine, "src/shapes.ts:Shape");

		const impls = engine.findImplementations(shape);

		const names = impls.map((h) => h.qualifiedName);
		expect(names).toContain("src/shapes.ts:Circle");
		expect(names).toContain("src/square.ts:Square");
	});
});
