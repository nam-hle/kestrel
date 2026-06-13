import { fileURLToPath } from "node:url";

import { it, expect, afterAll, describe } from "vitest";

import { Engine } from "../engine.js";
import { LspEngine } from "../lsp-engine.js";
import { tsgoBinPath } from "../lsp/tsgo-bin.js";

/**
 * The shared-base tsconfig footgun (issue #114): a tsconfig whose include points at a
 * src/ dir that doesn't exist next to it (the monorepo "base config" shape). The loaded
 * project has 0 source files — engines must report that instead of failing silently.
 */
const baseConfigPath = fileURLToPath(new URL("./fixtures/base-config/tsconfig.json", import.meta.url));
const samplePath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

describe("sourceFileCount", () => {
	it("reports 0 for a shared-base tsconfig with no matching files", () => {
		const engine = new Engine({ tsConfigPath: baseConfigPath });

		expect(engine.sourceFileCount()).toBe(0);
	});

	it("reports the project's file count for a real project", () => {
		const engine = new Engine({ tsConfigPath: samplePath });

		expect(engine.sourceFileCount()).toBeGreaterThan(0);
	});
});

describe.skipIf(tsgoBinPath() === undefined)("LspEngine on a shared-base tsconfig", () => {
	const lsp = new LspEngine({ tsConfigPath: baseConfigPath });

	afterAll(async () => {
		await lsp.dispose();
	});

	it("reports 0 source files", async () => {
		expect(await lsp.sourceFileCount()).toBe(0);
	});

	it("searchSymbol excludes declaration-output (.d.ts) hits", async () => {
		// tsgo searches the whole workspace folder here, surfacing pkg/lib/foo.d.ts —
		// a build-output twin of pkg/src/foo.ts. Declaration files must be filtered.
		const hits = await lsp.searchSymbol("fooMarker");

		expect(hits.length).toBeGreaterThan(0);
		expect(hits.every((h) => !h.position.file.endsWith(".d.ts"))).toBe(true);
	}, 30_000);
});
