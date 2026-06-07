import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine, LspEngine } from "../index.js";
import type { SymbolHandle } from "../index.js";
import { tsgoBinPath } from "../lsp/tsgo-bin.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));
const binAvailable = tsgoBinPath() !== undefined;

function resolve(engine: Engine, name: string): SymbolHandle {
	const r = engine.resolveSymbol(name);

	if (r.kind !== "symbol") {
		throw new Error(`expected symbol, got ${r.kind}`);
	}

	return r.symbol;
}

describe("symbolSource", () => {
	test("returns the exact declaration source of a function", () => {
		const engine = new Engine({ tsConfigPath });
		const [src] = engine.symbolSource(resolve(engine, "src/shapes.ts:makeCircle"));

		expect(src!.source).toContain("export function makeCircle");
		expect(src!.source).toContain("return new Circle");
		expect(src!.qualifiedName).toBe("src/shapes.ts:makeCircle");
		expect(src!.position.file).toBe("src/shapes.ts");
	});

	test("returns the class body source", () => {
		const engine = new Engine({ tsConfigPath });
		const [src] = engine.symbolSource(resolve(engine, "src/shapes.ts:Circle"));

		expect(src!.source).toContain("class Circle");
		expect(src!.source).toContain("area()");
	});
});

describe.skipIf(!binAvailable)("symbolSource (lsp parity)", () => {
	test("lsp engine returns source containing the declaration", async () => {
		const lsp = new LspEngine({ tsConfigPath });

		try {
			const r = await lsp.resolveSymbol("src/shapes.ts:makeCircle");

			if (r.kind !== "symbol") {
				throw new Error("expected symbol");
			}

			const [src] = await lsp.symbolSource(r.symbol);
			expect(src!.source).toContain("makeCircle");
		} finally {
			await lsp.dispose();
		}
	}, 30_000);
});
