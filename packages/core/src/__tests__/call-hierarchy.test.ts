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
});
