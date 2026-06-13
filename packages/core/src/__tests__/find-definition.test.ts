import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

function newEngine(): Engine {
	return new Engine({ tsConfigPath });
}

describe("resolveSymbol", () => {
	test("resolves an unambiguous top-level class by file:name", () => {
		const engine = newEngine();

		const result = engine.resolveSymbol("src/shapes.ts:Circle");

		expect(result.kind).toBe("symbol");

		if (result.kind !== "symbol") {
			return;
		}

		expect(result.symbol.qualifiedName).toBe("src/shapes.ts:Circle");
		expect(result.symbol.position.file).toBe("src/shapes.ts");
		expect(result.symbol.position.line).toBe(5);
	});

	test("suggests near-miss names on not-found", () => {
		const engine = newEngine();

		const result = engine.resolveSymbol("src/shapes.ts:Circel");

		expect(result.kind).toBe("not-found");

		if (result.kind !== "not-found") {
			return;
		}

		expect(result.suggestions).toContain("Circle");
	});

	test("returns not-found for a name that does not exist", () => {
		const engine = newEngine();

		const result = engine.resolveSymbol("src/shapes.ts:Nope");

		expect(result.kind).toBe("not-found");
	});

	test("hints --engine lsp when the name is an external import the default engine can't follow (#100)", () => {
		const engine = newEngine();

		const result = engine.resolveSymbol("src/external.ts:Node");

		expect(result.kind).toBe("not-found");

		if (result.kind !== "not-found") {
			return;
		}

		expect(result.hint).toBeDefined();
		expect(result.hint).toContain("--engine lsp");
		expect(result.hint).toContain("ts-morph");
	});

	test("does not hint lsp for a local import (resolvable in-project)", () => {
		const engine = newEngine();

		// `Circle` is imported from a relative module — the default engine resolves it there,
		// so addressing it in consumer.ts is a real miss, not an external-boundary one.
		const result = engine.resolveSymbol("src/consumer.ts:Circle");

		expect(result.kind).toBe("not-found");

		if (result.kind !== "not-found") {
			return;
		}

		expect(result.hint).toBeUndefined();
	});

	test("returns candidates when a name is declared more than once in a file", () => {
		const engine = newEngine();

		const result = engine.resolveSymbol("src/dup.ts:thing");

		expect(result.kind).toBe("ambiguous");

		if (result.kind !== "ambiguous") {
			return;
		}

		expect(result.candidates).toHaveLength(2);
		expect(result.candidates[0]?.qualifiedName).toBe("src/dup.ts:thing#0");
		expect(result.candidates[1]?.qualifiedName).toBe("src/dup.ts:thing#1");
	});

	test("resolves a specific declaration by index", () => {
		const engine = newEngine();

		const result = engine.resolveSymbol("src/dup.ts:thing#1");

		expect(result.kind).toBe("symbol");

		if (result.kind !== "symbol") {
			return;
		}

		expect(result.symbol.qualifiedName).toBe("src/dup.ts:thing#1");
	});
});

describe("findDefinition", () => {
	test("returns the declaration site of a resolved symbol", () => {
		const engine = newEngine();
		const resolved = engine.resolveSymbol("src/shapes.ts:makeCircle");

		if (resolved.kind !== "symbol") {
			throw new Error("expected symbol");
		}

		const defs = engine.findDefinition(resolved.symbol);

		expect(defs).toHaveLength(1);
		expect(defs[0]?.position.file).toMatch(/shapes\.ts$/);
		expect(defs[0]?.position.line).toBe(12);
	});
});
