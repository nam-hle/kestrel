import { createRequire } from "node:module";

import { it, expect, afterAll, describe } from "vitest";

import { LspClient } from "../../lsp/client.js";
import { tsgoBinPath } from "../../lsp/tsgo-bin.js";

const require = createRequire(import.meta.url);
const binAvailable = tsgoBinPath() !== undefined;

const root = require.resolve("../fixtures/sample/tsconfig.json").replace(/\/tsconfig\.json$/, "");

describe.skipIf(!binAvailable)("LspClient", () => {
	const client = new LspClient(root);

	afterAll(async () => {
		await client.dispose();
	});

	it("initializes and advertises referencesProvider", async () => {
		const caps = await client.start();
		expect(caps.referencesProvider).toBeTruthy();
	}, 20_000);
});
