import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

describe("re-export resolution", () => {
	test("resolves a named re-export through a barrel to its true declaration", () => {
		const engine = new Engine({ tsConfigPath });

		const result = engine.resolveSymbol("src/barrel.ts:Circle");

		expect(result.kind).toBe("symbol");

		if (result.kind !== "symbol") {
			return;
		}

		expect(result.symbol.position.file).toBe("src/shapes.ts");
		expect(result.symbol.position.line).toBe(5);
	});

	test("resolves a star re-export through a barrel", () => {
		const engine = new Engine({ tsConfigPath });

		// Square is exposed via `export * from "./square.js"` in barrel.ts.
		const result = engine.resolveSymbol("src/barrel.ts:Square");

		expect(result.kind).toBe("symbol");

		if (result.kind !== "symbol") {
			return;
		}

		expect(result.symbol.position.file).toBe("src/square.ts");
	});

	test("still reports not-found for a name that is neither local nor re-exported", () => {
		const engine = new Engine({ tsConfigPath });

		expect(engine.resolveSymbol("src/barrel.ts:Nope").kind).toBe("not-found");
	});
});
