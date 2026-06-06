import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

describe("namespace-nested resolution", () => {
	test("resolves a dotted path into a namespace", () => {
		const engine = new Engine({ tsConfigPath });

		const result = engine.resolveSymbol("src/nested.ts:Model.Node");

		expect(result.kind).toBe("symbol");

		if (result.kind !== "symbol") {
			return;
		}

		expect(result.symbol.qualifiedName).toBe("src/nested.ts:Model.Node");
		expect(result.symbol.position.line).toBe(2);
	});

	test("resolves a deeply nested dotted path", () => {
		const engine = new Engine({ tsConfigPath });

		const result = engine.resolveSymbol("src/nested.ts:Model.Inner.Node");

		expect(result.kind).toBe("symbol");

		if (result.kind !== "symbol") {
			return;
		}

		expect(result.symbol.position.line).toBe(7);
	});

	test("a bare nested name returns candidates with dotted paths", () => {
		const engine = new Engine({ tsConfigPath });

		const result = engine.resolveSymbol("src/nested.ts:Node");

		expect(result.kind).toBe("ambiguous");

		if (result.kind !== "ambiguous") {
			return;
		}

		const names = result.candidates.map((c) => c.qualifiedName);
		expect(names).toContain("src/nested.ts:Model.Node");
		expect(names).toContain("src/nested.ts:Model.Inner.Node");
		expect(names).toContain("src/nested.ts:Runtime.Node");
	});

	test("resolves the namespace itself by dotted path", () => {
		const engine = new Engine({ tsConfigPath });

		const result = engine.resolveSymbol("src/nested.ts:Model");

		expect(result.kind).toBe("symbol");

		if (result.kind !== "symbol") {
			return;
		}

		expect(result.symbol.position.line).toBe(1);
	});
});
