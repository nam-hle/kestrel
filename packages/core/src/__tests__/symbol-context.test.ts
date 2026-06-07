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

describe("symbolContext", () => {
	test("bundles signature, source, callees and type refs", () => {
		const engine = new Engine({ tsConfigPath });
		const ctx = engine.symbolContext(resolve(engine, "src/consumer.ts:totalArea"));

		expect(ctx.signature).toContain("totalArea");
		expect(ctx.signature).not.toMatch(/\{/);
		expect(ctx.source).toContain("makeCircle");
		expect(ctx.typeRefs).toContain("Circle");
		expect(Array.isArray(ctx.callees)).toBe(true);
		expect(ctx.callees.some((c) => c.qualifiedName.includes("makeCircle"))).toBe(true);
	});

	test("empty sections are arrays, not omitted", () => {
		const engine = new Engine({ tsConfigPath });
		const ctx = engine.symbolContext(resolve(engine, "src/shapes.ts:Shape"));

		expect(Array.isArray(ctx.callees)).toBe(true);
		expect(Array.isArray(ctx.typeRefs)).toBe(true);
	});
});

describe.skipIf(!binAvailable)("symbolContext (lsp parity)", () => {
	test("lsp engine bundles type refs and callees", async () => {
		const lsp = new LspEngine({ tsConfigPath });

		try {
			const r = await lsp.resolveSymbol("src/consumer.ts:totalArea");

			if (r.kind !== "symbol") {
				throw new Error("expected symbol");
			}

			const ctx = await lsp.symbolContext(r.symbol);
			expect(ctx.typeRefs).toContain("Circle");
			expect(ctx.callees.length).toBeGreaterThan(0);
		} finally {
			await lsp.dispose();
		}
	}, 30_000);
});
