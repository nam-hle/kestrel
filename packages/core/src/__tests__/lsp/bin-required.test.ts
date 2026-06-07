import { it, expect, describe } from "vitest";

import { tsgoBinPath } from "../../lsp/tsgo-bin.js";

/**
 * Guard against a false-green CI: the LSP suites are gated `skipIf(!binAvailable)`, so they
 * silently vanish if tsgo isn't present. CI sets KESTREL_REQUIRE_LSP=1 to assert the bin IS
 * available on platforms where it must be — turning a silent skip into a loud failure.
 */
describe("tsgo bin availability", () => {
	it("is present when KESTREL_REQUIRE_LSP is set (CI guard against silent skips)", () => {
		if (process.env.KESTREL_REQUIRE_LSP !== "1") {
			return; // local dev without the dep: nothing to assert
		}

		expect(tsgoBinPath(), "tsgo bin must resolve when KESTREL_REQUIRE_LSP=1 — the LSP tests would otherwise skip").toBeDefined();
	});
});
