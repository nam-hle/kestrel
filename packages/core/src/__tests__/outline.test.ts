import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

describe("outlineFile", () => {
	test("buckets the top-level declarations of a file", () => {
		const engine = new Engine({ tsConfigPath });

		const outline = engine.outlineFile("src/shapes.ts");

		expect(outline.classes.map((m) => m.name)).toContain("Circle");
		expect(outline.interfaces.map((m) => m.name)).toContain("Shape");
		expect(outline.functions.map((m) => m.name)).toContain("makeCircle");
	});

	test("surfaces declarations nested inside namespaces with dotted names", () => {
		const engine = new Engine({ tsConfigPath });

		const outline = engine.outlineFile("src/nested.ts");
		const names = outline.interfaces.map((m) => m.name);

		expect(names).toContain("Model::Node");
		expect(names).toContain("Model::Inner::Node");
		expect(names).toContain("Runtime::Node");
	});

	test("surfaces re-exports from a barrel file", () => {
		const engine = new Engine({ tsConfigPath });

		const outline = engine.outlineFile("src/barrel.ts");
		const names = outline.exports.map((m) => m.name);

		expect(names).toContain("Circle");
		expect(names).toContain("makeCircle");
		expect(names).toContain("Shape");
		expect(names).toContain("* from ./square.js");
	});

	test("does not leak function-body locals into the file outline", () => {
		const engine = new Engine({ tsConfigPath });

		const outline = engine.outlineFile("src/consumer.ts");
		const allNames = [...outline.functions, ...outline.variables, ...outline.classes].map((m) => m.name);

		// totalArea's body locals (sum, c) and averageArea's (total) must not appear.
		expect(allNames).toContain("totalArea");
		expect(allNames.some((n) => n.includes(".sum") || n.includes(".total") || n.endsWith(".c"))).toBe(false);
	});

	test("surfaces an arrow-const export as a function", () => {
		const engine = new Engine({ tsConfigPath });

		const outline = engine.outlineFile("src/consumer.ts");

		expect(outline.functions.map((m) => m.name)).toContain("averageArea");
	});

	test("surfaces a plain value const in the variables bucket", () => {
		const engine = new Engine({ tsConfigPath });

		const outline = engine.outlineFile("src/shapes.ts");

		expect(outline.variables.map((m) => m.name)).toContain("helper");
	});

	test("marks declarations with their exported status", () => {
		const engine = new Engine({ tsConfigPath });

		const outline = engine.outlineFile("src/shapes.ts");
		const circle = outline.classes.find((m) => m.name === "Circle");
		const box = outline.interfaces.find((m) => m.name === "Box");

		expect(circle?.exported).toBe(true);
		expect(box?.exported).toBe(true);
	});

	test("surfaces generic type parameters of a declaration", () => {
		const engine = new Engine({ tsConfigPath });

		const outline = engine.outlineFile("src/shapes.ts");
		const box = outline.interfaces.find((m) => m.name === "Box");

		expect(box?.typeParameters).toEqual(["T", "U"]);
	});

	test("flags type-only re-exports distinctly from value re-exports", () => {
		const engine = new Engine({ tsConfigPath });

		const outline = engine.outlineFile("src/barrel.ts");
		const shape = outline.exports.find((m) => m.name === "Shape");
		const circle = outline.exports.find((m) => m.name === "Circle");

		expect(shape?.kind).toBe("ExportSpecifier (type)");
		expect(circle?.kind).toBe("ExportSpecifier");
	});

	test("includes a signature and position for each declaration", () => {
		const engine = new Engine({ tsConfigPath });

		const outline = engine.outlineFile("src/shapes.ts");
		const circle = outline.classes.find((m) => m.name === "Circle");

		expect(circle).toBeDefined();
		expect(circle?.kind).toBe("ClassDeclaration");
		expect(circle?.position.line).toBe(5);
		expect(circle?.signature).toContain("Circle");
	});
});

describe("outlineSymbol", () => {
	test("lists the members of a class", () => {
		const engine = new Engine({ tsConfigPath });
		const resolved = engine.resolveSymbol("src/shapes.ts:Circle");

		if (resolved.kind !== "symbol") {
			throw new Error("expected symbol");
		}

		const members = engine.outlineSymbol(resolved.symbol);

		expect(members.map((m) => m.name)).toContain("area");
	});

	test("members carry an addressable qualifiedName", () => {
		const engine = new Engine({ tsConfigPath });
		const resolved = engine.resolveSymbol("src/shapes.ts:Circle");

		if (resolved.kind !== "symbol") {
			throw new Error("expected symbol");
		}

		const area = engine.outlineSymbol(resolved.symbol).find((m) => m.name === "area");

		expect(area?.qualifiedName).toBe("src/shapes.ts:Circle::area");
	});

	test("lists the members of an interface", () => {
		const engine = new Engine({ tsConfigPath });
		const resolved = engine.resolveSymbol("src/shapes.ts:Shape");

		if (resolved.kind !== "symbol") {
			throw new Error("expected symbol");
		}

		const members = engine.outlineSymbol(resolved.symbol);

		expect(members.map((m) => m.name)).toContain("area");
	});

	test("lists the members of a namespace", () => {
		const engine = new Engine({ tsConfigPath });
		const resolved = engine.resolveSymbol("src/nested.ts:Model");

		if (resolved.kind !== "symbol") {
			throw new Error("expected symbol");
		}

		const members = engine.outlineSymbol(resolved.symbol);
		const names = members.map((m) => m.name);

		expect(names).toContain("Node");
		expect(names).toContain("Inner");
	});
});
