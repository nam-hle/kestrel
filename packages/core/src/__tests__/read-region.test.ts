import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

describe("readRegion", () => {
	test("returns the requested inclusive line range", () => {
		const engine = new Engine({ tsConfigPath });
		const r = engine.readRegion("src/shapes.ts", 1, 3);

		expect(r.startLine).toBe(1);
		expect(r.endLine).toBe(3);
		expect(r.source.split("\n")).toHaveLength(3);
		expect(r.source).toContain("Shape");
	});

	test("clamps endLine to the file length", () => {
		const engine = new Engine({ tsConfigPath });
		const r = engine.readRegion("src/shapes.ts", 1, 100000);

		expect(r.endLine).toBeLessThan(100000);
	});

	test("throws on an inverted or non-positive range", () => {
		const engine = new Engine({ tsConfigPath });

		expect(() => engine.readRegion("src/shapes.ts", 5, 2)).toThrow(/invalid line range/);
		expect(() => engine.readRegion("src/shapes.ts", 0, 3)).toThrow(/invalid line range/);
	});
});
