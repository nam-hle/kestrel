import { fileURLToPath } from "node:url";

import { test, expect, describe } from "vitest";

import { resolveProjectFile } from "../../lsp/resolve-path.js";

// The sample fixture: tsconfig dir is the "root", source files live under it.
const root = fileURLToPath(new URL("../fixtures/sample", import.meta.url));

describe("resolveProjectFile", () => {
	test("resolves a cwd-relative path that exists, without joining onto root", () => {
		// A path relative to cwd whose prefix overlaps root must not double.
		const cwdRelative = "packages/core/src/__tests__/fixtures/sample/src/shapes.ts";
		const resolved = resolveProjectFile(root, cwdRelative);

		expect(resolved.endsWith("/fixtures/sample/src/shapes.ts")).toBe(true);
		// The bug produced ".../sample/packages/core/.../shapes.ts" — root joined onto a cwd path.
		expect(resolved).not.toContain("/sample/packages/");
	});

	test("falls back to root-relative when the path does not exist under cwd", () => {
		const resolved = resolveProjectFile(root, "src/shapes.ts");

		expect(resolved.endsWith("/fixtures/sample/src/shapes.ts")).toBe(true);
	});

	test("returns forward-slashed absolute paths", () => {
		const resolved = resolveProjectFile(root, "src/shapes.ts");

		expect(resolved).not.toContain("\\");
		expect(resolved.startsWith("/") || /^[A-Za-z]:/.test(resolved)).toBe(true);
	});
});
