import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";

import { it, expect, describe } from "vitest";

import { filesIn } from "../gain/files.js";
import type { GainEntry } from "../gain/ledger.js";
import { bytesToTokens } from "../gain/estimate.js";
import { read, record, aggregate } from "../gain/ledger.js";
import { renderHistory, renderSummary, renderByProject } from "../gain/command.js";

/** A temp ledger path under a fresh temp dir. */
function tmpLedger(): string {
	return join(mkdtempSync(join(tmpdir(), "kestrel-gain-")), "gain.jsonl");
}

/** Build a GainEntry with sensible defaults. */
function entry(over: Partial<GainEntry> = {}): GainEntry {
	return { ts: 1, files: 1, cwd: "/p", op: "find refs", kestrelTokens: 10, baselineTokens: 100, ...over };
}

describe("bytesToTokens", () => {
	it("rounds up chars/4", () => {
		expect(bytesToTokens(0)).toBe(0);
		expect(bytesToTokens(4)).toBe(1);
		expect(bytesToTokens(5)).toBe(2);
	});
});

describe("filesIn", () => {
	it("collects nested position.file and top-level file, deduped and sorted", () => {
		const result = {
			file: "src/b.ts",
			references: [{ position: { col: 1, line: 1, file: "src/a.ts" } }, { position: { col: 1, line: 2, file: "src/b.ts" } }]
		};
		expect(filesIn(result)).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("returns [] for empty and non-object input", () => {
		expect(filesIn({})).toEqual([]);
		expect(filesIn([])).toEqual([]);
		expect(filesIn(null)).toEqual([]);
		expect(filesIn("x")).toEqual([]);
		expect(filesIn(42)).toEqual([]);
	});

	it("ignores non-string file values", () => {
		expect(filesIn({ file: 123 })).toEqual([]);
	});
});

describe("ledger", () => {
	it("round-trips an appended entry", () => {
		const path = tmpLedger();
		record(entry({ op: "view outline" }), path);
		const got = read(path);
		expect(got).toHaveLength(1);
		expect(got[0]!.op).toBe("view outline");
	});

	it("skips malformed lines and keeps valid neighbours", () => {
		const path = tmpLedger();
		writeFileSync(path, `${JSON.stringify(entry({ op: "a" }))}\nnot json\n${JSON.stringify(entry({ op: "b" }))}\n`);
		expect(read(path).map((e) => e.op)).toEqual(["a", "b"]);
	});

	it("returns [] for a missing ledger", () => {
		expect(read(join(tmpdir(), "kestrel-gain-does-not-exist", "gain.jsonl"))).toEqual([]);
	});

	it("no-ops on a null path (no home dir) instead of writing cwd-relative", () => {
		expect(() => record(entry(), null)).not.toThrow();
		expect(read(null)).toEqual([]);
	});

	it("aggregates sums and percent saved", () => {
		const agg = aggregate([entry({ kestrelTokens: 10, baselineTokens: 100 }), entry({ kestrelTokens: 20, baselineTokens: 100 })]);
		expect(agg.queries).toBe(2);
		expect(agg.kestrelTokens).toBe(30);
		expect(agg.baselineTokens).toBe(200);
		expect(agg.savedTokens).toBe(170);
		expect(agg.savedPct).toBeCloseTo(85);
	});

	it("ranks top ops by count", () => {
		const agg = aggregate([entry({ op: "find refs" }), entry({ op: "find refs" }), entry({ op: "view outline" })]);
		expect(agg.topOps[0]).toEqual(["find refs", 2]);
		expect(agg.topOps[1]).toEqual(["view outline", 1]);
	});

	it("groups by project when requested", () => {
		const agg = aggregate(
			[entry({ cwd: "/a", kestrelTokens: 10, baselineTokens: 100 }), entry({ cwd: "/b", kestrelTokens: 5, baselineTokens: 50 })],
			{
				byProject: true
			}
		);
		expect(agg.byProject).toHaveLength(2);
		expect(agg.byProject![0]!.cwd).toBe("/a");
		expect(agg.byProject![0]!.savedTokens).toBe(90);
	});

	it("zeroes an empty aggregate", () => {
		const agg = aggregate([]);
		expect(agg).toMatchObject({ queries: 0, savedPct: 0, savedTokens: 0, kestrelTokens: 0, baselineTokens: 0 });
	});
});

describe("command rendering", () => {
	it("renders a summary with ~-prefixed figures", () => {
		const out = renderSummary(aggregate([entry({ kestrelTokens: 1000, baselineTokens: 20000 })]));
		expect(out).toContain("queries:   1");
		expect(out).toContain("~1.0k tok");
		expect(out).toContain("~95%");
		expect(out).toContain("find refs (1)");
	});

	it("renders the empty-ledger message", () => {
		expect(renderSummary(aggregate([]))).toBe("no gain recorded yet");
	});

	it("renders history lines, one per entry capped at the limit", () => {
		const entries = [entry({ ts: 1, op: "a" }), entry({ ts: 2, op: "b" }), entry({ ts: 3, op: "c" })];
		const out = renderHistory(entries, 2);
		const lines = out.split("\n");
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("b");
		expect(lines[1]).toContain("c");
	});

	it("renders per-project grouping", () => {
		const agg = aggregate([entry({ cwd: "/proj-x" })], { byProject: true });
		expect(renderByProject(agg)).toContain("/proj-x");
	});
});
