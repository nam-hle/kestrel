import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine, LspEngine } from "../index.js";
import { tsgoBinPath } from "../lsp/tsgo-bin.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));
const binAvailable = tsgoBinPath() !== undefined;

describe("searchSymbol", () => {
	test("finds every declaration of a name across the repo", () => {
		const engine = new Engine({ tsConfigPath });

		const hits = engine.searchSymbol("Node");

		const names = hits.map((h) => h.qualifiedName);
		expect(names).toContain("src/nested.ts:Model::Node");
		expect(names).toContain("src/nested.ts:Model::Inner::Node");
		expect(names).toContain("src/nested.ts:Runtime::Node");
	});

	test("matches the exact name, not substrings, by default", () => {
		const engine = new Engine({ tsConfigPath });

		const hits = engine.searchSymbol("Circle");

		expect(hits.map((h) => h.qualifiedName)).toEqual(["src/shapes.ts:Circle"]);
	});

	test("matches substrings when contains is set", () => {
		const engine = new Engine({ tsConfigPath });

		const exact = engine.searchSymbol("Make");
		const contains = engine.searchSymbol("Make", { contains: true });

		expect(exact).toHaveLength(0);
		expect(contains.map((h) => h.qualifiedName)).toContain("src/shapes.ts:makeCircle");
	});

	test("returns an empty list when nothing matches", () => {
		const engine = new Engine({ tsConfigPath });

		expect(engine.searchSymbol("DoesNotExistAnywhere")).toEqual([]);
	});

	test("finds a shorthand method declared inside an object literal", () => {
		const engine = new Engine({ tsConfigPath });

		const names = engine.searchSymbol("greet").map((h) => h.qualifiedName);

		// class member already worked; the object-literal member is the regression target (#95).
		expect(names).toContain("src/resolvers.ts:LoudGreeter::greet");
		expect(names).toContain("src/resolvers.ts:politeGreeter::greet");
	});
});

describe.skipIf(!binAvailable)("searchSymbol (lsp engine, cold index)", () => {
	test("finds a symbol on the first call without any file opened first", async () => {
		// tsgo's workspace/symbol is empty until the project is indexed; searchSymbol must
		// warm it. This is the first call on a fresh engine — nothing opened yet.
		const lsp = new LspEngine({ tsConfigPath });

		try {
			const hits = await lsp.searchSymbol("makeCircle");
			expect(hits.map((h) => h.qualifiedName)).toContain("src/shapes.ts:makeCircle");
		} finally {
			await lsp.dispose();
		}
	}, 30_000);

	test("finds a symbol that lives outside the first-indexed file", async () => {
		// Regression for #90: warming the index by opening only the *first* source file left
		// workspace/symbol blind to symbols declared elsewhere — they came back empty.
		const lsp = new LspEngine({ tsConfigPath });

		try {
			const hits = await lsp.searchSymbol("totalArea");
			expect(hits.map((h) => h.qualifiedName)).toContain("src/consumer.ts:totalArea");
		} finally {
			await lsp.dispose();
		}
	}, 30_000);

	test("classifies the symbol kind, matching the ts-morph engine", async () => {
		// workspace/symbol carries an LSP SymbolKind; dropping it to "unknown" robbed the
		// orientation signal (can't tell an interface from a fn at a glance). The lsp engine
		// must map it to the same ts-morph getKindName() string the renderer compacts.
		const lsp = new LspEngine({ tsConfigPath });

		try {
			const iface = await lsp.searchSymbol("Shape", { contains: true });
			const circle = iface.find((h) => h.qualifiedName === "src/shapes.ts:Shape");
			expect(circle?.kind).toBe("InterfaceDeclaration");

			const fn = await lsp.searchSymbol("makeCircle");
			expect(fn[0]?.kind).toBe("FunctionDeclaration");
		} finally {
			await lsp.dispose();
		}
	}, 30_000);
});
