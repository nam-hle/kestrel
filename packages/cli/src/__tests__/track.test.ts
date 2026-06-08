import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";

import { it, expect, describe, afterEach, beforeEach } from "vitest";

import { recordGain } from "../gain/track.js";
import { ledgerPath } from "../gain/ledger.js";

/**
 * recordGain writes to `~/.symantic/gain.jsonl`, resolved via $HOME. Point HOME at a temp dir
 * so the test is hermetic and we can read the ledger back.
 */
describe("recordGain", () => {
	let home: string;
	let origHome: string | undefined;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "symantic-track-"));
		origHome = process.env.HOME;
		process.env.HOME = home;
	});

	afterEach(() => {
		if (origHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = origHome;
		}
	});

	it("appends a ledger entry sized from the result's referenced files", () => {
		// A tsconfig dir with one source file the result references.
		const projectDir = mkdtempSync(join(tmpdir(), "symantic-proj-"));
		const tsconfig = join(projectDir, "tsconfig.json");
		writeFileSync(tsconfig, "{}");
		writeFileSync(join(projectDir, "a.ts"), "export const x = 1;\n"); // 20 bytes → ~5 tokens

		const result = { references: [{ position: { col: 1, line: 1, file: "a.ts" } }] };
		recordGain("find refs", result, "emitted text", tsconfig);

		const path = ledgerPath()!;
		expect(existsSync(path)).toBe(true);

		const entry = JSON.parse(readFileSync(path, "utf8").trim()) as {
			op: string;
			files: number;
			baselineTokens: number;
			symanticTokens: number;
		};
		expect(entry.op).toBe("find refs");
		expect(entry.files).toBe(1);
		expect(entry.baselineTokens).toBeGreaterThan(0); // baseline = bytes of a.ts / 4
		expect(entry.symanticTokens).toBe(Math.ceil("emitted text".length / 4));
	});

	it("never throws when the tsconfig path is unreadable (observability is best-effort)", () => {
		expect(() => recordGain("find refs", { references: [] }, "out", "/no/such/tsconfig.json")).not.toThrow();
	});
});
