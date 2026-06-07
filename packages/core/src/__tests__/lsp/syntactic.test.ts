import { it, expect, describe } from "vitest";

import { classifyAt, buildOutline, parseImports, functionSkeleton } from "../../lsp/syntactic.js";

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

const shapes = `export interface Shape {
	area(): number;
}

export class Circle implements Shape {
	area(): number {
		return 1;
	}
}

export function makeCircle(): Circle {
	return new Circle();
}

export interface Box<T, U> {
	value: T;
}
`;

describe("buildOutline", () => {
	it("buckets interfaces / classes / functions with exported flag", () => {
		const o = buildOutline("src/shapes.ts", shapes);
		expect(o.interfaces.map((m) => m.name).sort()).toEqual(["Box", "Shape"]);
		expect(o.classes.map((m) => m.name)).toEqual(["Circle"]);
		expect(o.functions.map((m) => m.name)).toEqual(["makeCircle"]);
		expect(o.classes[0]!.exported).toBe(true);
	});

	it("captures generic type parameters", () => {
		const o = buildOutline("src/shapes.ts", shapes);
		expect(o.interfaces.find((m) => m.name === "Box")!.typeParameters).toEqual(["T", "U"]);
	});
});

describe("functionSkeleton", () => {
	it("returns the top-level statement kinds of a function body", () => {
		// Line 10 (0-based), character 16 lands on "makeCircle" (after "export function ").
		const o = functionSkeleton(shapes, { line: 10, character: 16 }, 1);
		expect(o.map((s) => s.kind)).toContain("ReturnStatement");
	});
});
