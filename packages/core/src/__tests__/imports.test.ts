import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

describe("listImports", () => {
	test("lists named imports of a file with their module", () => {
		const engine = new Engine({ tsConfigPath });

		const imports = engine.listImports("src/consumer.ts");

		const shapes = imports.find((i) => /shapes\.js$/.test(i.module));
		expect(shapes).toBeDefined();
		expect(shapes?.named).toContain("makeCircle");
		expect(shapes?.named).toContain("Circle");
	});

	test("returns an empty list for a file with no imports", () => {
		const engine = new Engine({ tsConfigPath });

		expect(engine.listImports("src/nested.ts")).toEqual([]);
	});
});
