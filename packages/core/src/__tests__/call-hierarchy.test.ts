import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";
import type { CallNode, SymbolHandle } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

function resolve(engine: Engine, name: string): SymbolHandle {
	const result = engine.resolveSymbol(name);

	if (result.kind !== "symbol") {
		throw new Error(`expected symbol, got ${result.kind}`);
	}

	return result.symbol;
}

function names(nodes: CallNode[]): string[] {
	return nodes.map((n) => n.qualifiedName.split(":").pop() ?? "");
}

describe("callHierarchy", () => {
	test("incoming: lists the functions that call the symbol", () => {
		const engine = new Engine({ tsConfigPath });
		const symbol = resolve(engine, "src/shapes.ts:makeCircle");

		const callers = engine.callHierarchy(symbol, { depth: 1, direction: "incoming" });

		expect(names(callers)).toContain("totalArea");
	});

	test("outgoing: lists the functions the symbol calls", () => {
		const engine = new Engine({ tsConfigPath });
		const symbol = resolve(engine, "src/consumer.ts:averageArea");

		const callees = engine.callHierarchy(symbol, { depth: 1, direction: "outgoing" });

		expect(names(callees)).toContain("totalArea");
	});

	test("outgoing: descends into an arrow-bound class property's body", () => {
		const engine = new Engine({ tsConfigPath });
		const symbol = resolve(engine, "src/consumer.ts:AreaService::compute");

		const callees = engine.callHierarchy(symbol, { depth: 1, direction: "outgoing" });

		expect(names(callees)).toContain("averageArea");
	});

	test("outgoing: descends into an object-literal property's body", () => {
		const engine = new Engine({ tsConfigPath });
		const symbol = resolve(engine, "src/consumer.ts:makeCalculators::mean");

		const callees = engine.callHierarchy(symbol, { depth: 1, direction: "outgoing" });

		expect(names(callees)).toContain("averageArea");
	});

	test("outgoing: descends into a function nested in a factory body", () => {
		const engine = new Engine({ tsConfigPath });
		const symbol = resolve(engine, "src/consumer.ts:makeSelectors::mean");

		const callees = engine.callHierarchy(symbol, { depth: 1, direction: "outgoing" });

		expect(names(callees)).toContain("averageArea");
	});

	test("incoming: names arrow/expression-bodied callers, never (anonymous) (#118)", () => {
		const engine = new Engine({ tsConfigPath });
		const symbol = resolve(engine, "src/consumer.ts:averageArea");

		const callers = names(engine.callHierarchy(symbol, { depth: 1, direction: "incoming" }));

		// averageArea is called from describeArea (fn), AreaService.compute (arrow class prop),
		// and object-literal `mean` arrow props. Every caller resolves to its name-bearing
		// declaration — none read as "(anonymous)".
		expect(callers).not.toContain("(anonymous)");
		expect(callers).toContain("describeArea");
		expect(callers).toContain("compute"); // arrow-bound class property
		expect(callers).toContain("mean"); // arrow in an object-literal property
	});

	test("mutual recursion terminates and dedupes by position, not node identity", () => {
		const engine = new Engine({ tsConfigPath });
		const symbol = resolve(engine, "src/recursion.ts:ping");

		// Deep walk over ping <-> pong: the cycle guard must visit each declaration
		// once. A guard keyed on node identity can re-add the same source position
		// reached via a distinct ts-morph wrapper, growing the tree past the cycle.
		const tree = engine.callHierarchy(symbol, { depth: 10, direction: "outgoing" });

		const seen = new Set<string>();
		const collect = (nodes: CallNode[]): void => {
			for (const n of nodes) {
				// `file:Lline:col` — the stable position key the guard should use.
				const key = `${n.position.file}:${n.position.line}:${n.position.col}`;
				expect(seen.has(key)).toBe(false);
				seen.add(key);
				collect(n.calls);
			}
		};

		collect(tree);
		// ping calls pong, pong calls ping (deduped) — exactly the two declarations.
		expect([...seen].some((k) => k.includes("recursion.ts"))).toBe(true);
		expect(seen.size).toBeLessThanOrEqual(2);
	});
});
