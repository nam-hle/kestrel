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

describe("findUsages", () => {
	test("finds usages of a function across files", () => {
		const engine = new Engine({ tsConfigPath });
		const symbol = resolve(engine, "src/shapes.ts:makeCircle");

		const { total, references } = engine.findUsages(symbol);

		expect(total).toBe(references.length);
		// findReferencesAsNodes excludes the declaration site — usages only.
		const files = references.map((r) => r.position.file);
		expect(files.some((f) => /consumer\.ts$/.test(f))).toBe(true);
		expect(references.some((r) => r.kind === "import")).toBe(true);
		expect(references.some((r) => r.kind === "call")).toBe(true);
	});

	test("respects a result-set limit and returns a cursor", () => {
		const engine = new Engine({ tsConfigPath });
		const symbol = resolve(engine, "src/shapes.ts:makeCircle");

		const page = engine.findUsages(symbol, { limit: 1 });

		expect(page.references).toHaveLength(1);
		expect(page.total).toBeGreaterThan(1);
		expect(page.nextCursor).toBeDefined();
	});
});
