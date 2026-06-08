import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";

import { test, expect, describe } from "vitest";

import { resolveTsconfig } from "../tsconfig.js";

describe("resolveTsconfig", () => {
	test("explicit path wins, returned as-is", () => {
		expect(resolveTsconfig("some/tsconfig.json")).toBe("some/tsconfig.json");
		expect(resolveTsconfig("some/tsconfig.json", "/whatever")).toBe("some/tsconfig.json");
	});

	test("discovers the nearest tsconfig.json walking up from startDir", () => {
		const root = mkdtempSync(join(tmpdir(), "sym-tsc-"));
		writeFileSync(join(root, "tsconfig.json"), "{}");
		const nested = join(root, "a", "b");
		mkdirSync(nested, { recursive: true });

		expect(resolveTsconfig(undefined, nested)).toBe(join(root, "tsconfig.json"));
	});

	test("prefers the closest tsconfig.json when several are on the path", () => {
		const root = mkdtempSync(join(tmpdir(), "sym-tsc-"));
		writeFileSync(join(root, "tsconfig.json"), "{}");
		const pkg = join(root, "pkg");
		mkdirSync(pkg, { recursive: true });
		writeFileSync(join(pkg, "tsconfig.json"), "{}");

		expect(resolveTsconfig(undefined, pkg)).toBe(join(pkg, "tsconfig.json"));
	});

	test("throws a clear error when no tsconfig is found", () => {
		const root = mkdtempSync(join(tmpdir(), "sym-tsc-"));
		// A temp dir with no tsconfig up to the fs root won't find one quickly; use a
		// dir we know is clean. (tmp parents may have none.)
		expect(() => resolveTsconfig(undefined, root)).toThrow(/no tsconfig\.json found|--tsconfig/);
	});
});
