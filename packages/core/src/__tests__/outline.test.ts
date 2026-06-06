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

		expect(names).toContain("Model.Node");
		expect(names).toContain("Model.Inner.Node");
		expect(names).toContain("Runtime.Node");
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
