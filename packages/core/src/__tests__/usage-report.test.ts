import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { Engine } from "../index.js";

const tsConfigPath = fileURLToPath(new URL("./fixtures/sample/tsconfig.json", import.meta.url));

describe("usageReport", () => {
	test("reports each public symbol of an entry with reference counts", () => {
		const engine = new Engine({ tsConfigPath });

		const report = engine.usageReport("src/shapes.ts");
		const byName = new Map(report.map((e) => [e.qualifiedName.split(":").pop(), e]));

		// makeCircle is consumed in consumer.ts (call + import).
		const makeCircle = byName.get("makeCircle");
		expect(makeCircle).toBeDefined();
		expect(makeCircle!.total).toBeGreaterThan(0);
		expect(makeCircle!.consumed).toBeGreaterThan(0);
	});

	test("excludeTests drops test-file references from the counts", () => {
		const engine = new Engine({ tsConfigPath });

		const withTests = engine.usageReport("src/shapes.ts").find((e) => e.qualifiedName.endsWith(":makeCircle"));
		const noTests = engine.usageReport("src/shapes.ts", { excludeTests: true }).find((e) => e.qualifiedName.endsWith(":makeCircle"));

		expect(noTests!.total).toBeLessThan(withTests!.total);
	});
});
