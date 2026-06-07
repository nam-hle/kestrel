import { it, expect, describe } from "vitest";

import { classifyAt, parseImports } from "../../lsp/syntactic.js";

const consumer = `import { makeCircle, Circle } from "./shapes.js";

export function totalArea(count: number): number {
	const c: Circle = makeCircle(count);
	return c.area();
}
`;

describe("parseImports", () => {
	it("extracts named imports + module", () => {
		const imports = parseImports("src/consumer.ts", consumer);
		expect(imports).toHaveLength(1);
		expect(imports[0]!.module).toBe("./shapes.js");
		expect(imports[0]!.named).toEqual(["makeCircle", "Circle"]);
		expect(imports[0]!.position.line).toBe(1);
	});
});

describe("classifyAt", () => {
	it("classifies an import-specifier occurrence as import", () => {
		// "makeCircle" in the import clause, line 1.
		expect(classifyAt(consumer, { line: 0, character: 9 })).toBe("import");
	});

	it("classifies a call target as call", () => {
		// "makeCircle(count)" on line 4 (0-based line 3).
		const idx = consumer.indexOf("makeCircle(count)");
		const before = consumer.slice(0, idx);
		const line = before.split("\n").length - 1;
		const character = idx - before.lastIndexOf("\n") - 1;
		expect(classifyAt(consumer, { line, character })).toBe("call");
	});
});
