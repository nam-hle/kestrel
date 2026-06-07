import { createRequire } from "node:module";

import { it, expect, afterAll, describe } from "vitest";

import { Engine } from "../engine.js";
import { LspEngine } from "../lsp-engine.js";
import { tsgoBinPath } from "../lsp/tsgo-bin.js";

const require = createRequire(import.meta.url);
const binAvailable = tsgoBinPath() !== undefined;

const tsConfigPath = require.resolve("./fixtures/sample/tsconfig.json");

describe.skipIf(!binAvailable)("LspEngine", () => {
	const lsp = new LspEngine({ tsConfigPath });
	const tsmorph = new Engine({ tsConfigPath });

	afterAll(async () => {
		await lsp.dispose();
	});

	it("resolves a symbol to the same position as the ts-morph engine", async () => {
		const r = await lsp.resolveSymbol("src/shapes.ts:makeCircle");
		const baseline = tsmorph.resolveSymbol("src/shapes.ts:makeCircle");

		expect(r.kind).toBe("symbol");
		expect(baseline.kind).toBe("symbol");

		// Both are "symbol" — assert positions match (type-assert to narrow).
		const rPos = r.kind === "symbol" ? r.symbol.position : null;
		const bPos = baseline.kind === "symbol" ? baseline.symbol.position : null;

		expect(rPos).toEqual(bPos);
	}, 30_000);

	it("finds the same references as the ts-morph engine for makeCircle", async () => {
		const resolved = await lsp.resolveSymbol("src/shapes.ts:makeCircle");

		if (resolved.kind !== "symbol") {
			throw new Error("expected symbol");
		}

		const usages = await lsp.findUsages(resolved.symbol);
		const files = usages.references.map((r) => r.position.file).sort();

		expect(files).toContain("src/consumer.ts");
	}, 30_000);

	it("finds implementations of an interface", async () => {
		const resolved = await lsp.resolveSymbol("src/shapes.ts:Shape");

		if (resolved.kind !== "symbol") {
			throw new Error("expected symbol");
		}

		const impls = await lsp.findImplementations(resolved.symbol);

		expect(impls.some((h) => h.qualifiedName.includes("Circle"))).toBe(true);
	}, 30_000);

	it("lists imports via the parser, matching the ts-morph engine", async () => {
		const lspImports = await lsp.listImports("src/consumer.ts");
		const baseline = tsmorph.listImports("src/consumer.ts");

		expect(lspImports.map((i) => i.module)).toEqual(baseline.map((i) => i.module));
	}, 30_000);

	it("resolves a re-exported symbol through a barrel", async () => {
		const r = await lsp.resolveSymbol("src/barrel.ts:Circle");

		if (r.kind !== "symbol") {
			throw new Error(`expected symbol, got ${r.kind}`);
		}

		// True declaration lives in shapes.ts, not the barrel.
		expect(r.symbol.position.file).toBe("src/shapes.ts");
	}, 30_000);
});
