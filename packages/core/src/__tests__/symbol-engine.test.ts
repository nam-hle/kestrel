import { it, describe, expectTypeOf } from "vitest";

import { type Engine } from "../engine.js";
import type { SymbolEngine } from "../symbol-engine.js";

describe("SymbolEngine", () => {
	it("Engine is assignable to SymbolEngine", () => {
		expectTypeOf<Engine>().toMatchTypeOf<SymbolEngine>();
	});
});
