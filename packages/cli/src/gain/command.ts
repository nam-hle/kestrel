import { defineCommand } from "citty";

import { read, aggregate } from "./ledger.js";
import type { GainEntry, Aggregate } from "./ledger.js";

/**
 * The `gain` subcommand: report cumulative estimated token savings from the
 * ledger. Default is a summary; `--history` lists recent queries, `--by-project`
 * groups by directory, `--json` emits the machine-readable aggregate.
 *
 * Every figure is `~`-prefixed: the chars/4 token estimate is documented as an
 * estimate, and the baseline counts only the files each result referenced.
 */

/** Format a token count compactly: 1234 → ~1.2k, 950 → ~950. */
function fmt(tokens: number): string {
	if (Math.abs(tokens) >= 1000) {
		return `~${(tokens / 1000).toFixed(1)}k tok`;
	}

	return `~${tokens} tok`;
}

/** Render the default summary block from an aggregate. */
export function renderSummary(agg: Aggregate): string {
	if (agg.queries === 0) {
		return "no gain recorded yet";
	}

	const topOps = agg.topOps
		.slice(0, 3)
		.map(([op, count]) => `${op} (${count})`)
		.join(", ");

	return [
		`  queries:   ${agg.queries}`,
		`  symantic:   ${fmt(agg.symanticTokens)}`,
		`  baseline:  ${fmt(agg.baselineTokens)}`,
		`  saved:     ${fmt(agg.savedTokens)} (~${Math.round(agg.savedPct)}%)`,
		`  top ops:   ${topOps}`
	].join("\n");
}

/** Render the per-project grouping block. */
export function renderByProject(agg: Aggregate): string {
	if (agg.byProject === undefined || agg.byProject.length === 0) {
		return "no gain recorded yet";
	}

	return agg.byProject
		.map((p) => `  ${p.cwd}\n    ${p.queries} queries, saved ${fmt(p.savedTokens)} (~${pct(p.savedTokens, p.baselineTokens)}%)`)
		.join("\n");
}

/** Render the recent-history block: the last `limit` entries, newest last. */
export function renderHistory(entries: GainEntry[], limit = 20): string {
	if (entries.length === 0) {
		return "no gain recorded yet";
	}

	return entries
		.slice(-limit)
		.map((e) => `  ${new Date(e.ts).toISOString()}  ${e.op}  saved ${fmt(e.baselineTokens - e.symanticTokens)}`)
		.join("\n");
}

/** Percent of `baseline` saved, rounded; 0 when there is no baseline. */
function pct(saved: number, baseline: number): number {
	return baseline === 0 ? 0 : Math.round((saved / baseline) * 100);
}

export const gain = defineCommand({
	meta: {
		name: "gain",
		description: "Report estimated token savings vs reading raw files (chars/4 estimate; recorded on by default to ~/.symantic/gain.jsonl)"
	},
	args: {
		json: { type: "boolean", description: "Emit the machine-readable aggregate" },
		"by-project": { type: "boolean", description: "Group totals by project directory" },
		history: { type: "boolean", description: "List recent queries instead of the summary" }
	},
	run({ args }) {
		const entries = read();
		const byProject = args["by-project"] === true;
		const agg = aggregate(entries, { byProject });

		if (args.json === true) {
			process.stdout.write(`${JSON.stringify(agg, null, 2)}\n`);

			return;
		}

		if (args.history === true) {
			process.stdout.write(`${renderHistory(entries)}\n`);

			return;
		}

		if (byProject) {
			process.stdout.write(`${renderByProject(agg)}\n`);

			return;
		}

		process.stdout.write(`${renderSummary(agg)}\n`);
	}
});
