import { createRequire } from "node:module";

import { it, expect, describe } from "vitest";

import { Engine } from "../engine.js";
import { asAsync } from "../create-engine.js";
import { tsgoBinPath } from "../lsp/tsgo-bin.js";
import { createEngine } from "../create-engine.js";

const require = createRequire(import.meta.url);
const tsConfigPath = require.resolve("./fixtures/sample/tsconfig.json");
const binAvailable = tsgoBinPath() !== undefined;

describe("asAsync", () => {
	it("wraps a sync Engine so every op returns a Promise", async () => {
		const async = asAsync(new Engine({ tsConfigPath }));
		const r = await async.resolveSymbol("src/shapes.ts:makeCircle");

		expect(r.kind).toBe("symbol");
	});

	it("exposes an awaitable refreshIfStale", async () => {
		const async = asAsync(new Engine({ tsConfigPath }));

		await expect(async.refreshIfStale()).resolves.toBeUndefined();
	});

	it("dispose is a no-op for the ts-morph engine", async () => {
		const async = asAsync(new Engine({ tsConfigPath }));

		await expect(async.dispose()).resolves.toBeUndefined();
	});
});

describe("createEngine", () => {
	it("defaults to the ts-morph engine", async () => {
		const engine = createEngine({ tsConfigPath });

		try {
			const r = await engine.resolveSymbol("src/shapes.ts:makeCircle");

			expect(r.kind).toBe("symbol");
		} finally {
			await engine.dispose();
		}
	});

	it("selects the ts-morph engine explicitly", async () => {
		const engine = createEngine({ tsConfigPath, engine: "tsmorph" });

		try {
			expect((await engine.resolveSymbol("src/shapes.ts:Circle")).kind).toBe("symbol");
		} finally {
			await engine.dispose();
		}
	});

	it.skipIf(!binAvailable)(
		"selects the tsgo LSP engine",
		async () => {
			const engine = createEngine({ tsConfigPath, engine: "lsp" });

			try {
				const r = await engine.resolveSymbol("src/shapes.ts:makeCircle");

				expect(r.kind).toBe("symbol");
			} finally {
				await engine.dispose();
			}
		},
		30_000
	);

	it("throws on an unknown engine name", () => {
		// @ts-expect-error — exercising the runtime guard with a bad value.
		expect(() => createEngine({ tsConfigPath, engine: "nope" })).toThrow(/unknown engine/i);
	});
});
