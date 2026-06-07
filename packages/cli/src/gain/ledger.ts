import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, appendFileSync } from "node:fs";

/**
 * Persistent ledger of query token-savings, appended one JSON line per query to
 * a global file (`~/.kestrel/gain.jsonl`, like rtk). The `gain` command reads it
 * back to report cumulative savings.
 *
 * Gain is observability: it must never break a query. Every I/O failure here is
 * swallowed — a missing home dir, read-only FS, or malformed line is a no-op, not
 * an error.
 */

/** One recorded query: its op, the files its result referenced, and the token tallies. */
export interface GainEntry {
	/** ms epoch, stamped by the caller (Date.now lives in the CLI, not these pure-ish fns). */
	ts: number;
	/** The query op, e.g. "find refs", "view outline". */
	op: string;
	/** The directory the query ran in, for per-project grouping. */
	cwd: string;
	/** Count of distinct files the result referenced. */
	files: number;
	/** Estimated tokens of kestrel's emitted output. */
	kestrelTokens: number;
	/** Estimated tokens to read the referenced files raw — the honest alternative. */
	baselineTokens: number;
}

/** A per-project (cwd) sub-total within an aggregate. */
export interface ProjectTotal {
	cwd: string;
	queries: number;
	savedTokens: number;
	kestrelTokens: number;
	baselineTokens: number;
}

/** Cumulative totals computed from a set of ledger entries. */
export interface Aggregate {
	queries: number;
	/** Percent of baseline saved, 0 when there is no baseline. */
	savedPct: number;
	savedTokens: number;
	kestrelTokens: number;
	baselineTokens: number;
	/** Per-project totals, present only when `byProject` was requested. */
	byProject?: ProjectTotal[];
	/** Ops by descending query count: [op, count]. */
	topOps: Array<[string, number]>;
}

/**
 * Absolute path to the gain ledger (`~/.kestrel/gain.jsonl`), or null when the
 * home dir cannot be resolved. `homedir()` returns "" when `$HOME` is unset (CI,
 * containers, cron) — joining that yields a cwd-relative path that would scatter
 * `.kestrel/` into whatever directory the query ran from, so guard against it.
 */
export function ledgerPath(): string | null {
	const home = homedir();

	return home === "" ? null : join(home, ".kestrel", "gain.jsonl");
}

/** Append one entry as a JSON line. All I/O failures are swallowed. */
export function record(entry: GainEntry, path: string | null = ledgerPath()): void {
	if (path === null) {
		return;
	}

	try {
		mkdirSync(dirname(path), { recursive: true });
		appendFileSync(path, `${JSON.stringify(entry)}\n`);
	} catch {
		// Observability must never break a query.
	}
}

/** Read all entries, skipping malformed lines. Missing file or no home dir → []. */
export function read(path: string | null = ledgerPath()): GainEntry[] {
	if (path === null) {
		return [];
	}

	let raw: string;

	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return [];
	}

	const entries: GainEntry[] = [];

	for (const line of raw.split("\n")) {
		if (line.trim() === "") {
			continue;
		}

		try {
			const parsed = JSON.parse(line) as unknown;

			if (isGainEntry(parsed)) {
				entries.push(parsed);
			}
		} catch {
			// Skip malformed line, keep the rest.
		}
	}

	return entries;
}

/** Compute cumulative totals; pass `byProject` to also group by cwd. */
export function aggregate(entries: GainEntry[], opts: { byProject?: boolean } = {}): Aggregate {
	let kestrelTokens = 0;
	let baselineTokens = 0;
	const opCounts = new Map<string, number>();

	for (const entry of entries) {
		kestrelTokens += entry.kestrelTokens;
		baselineTokens += entry.baselineTokens;
		opCounts.set(entry.op, (opCounts.get(entry.op) ?? 0) + 1);
	}

	const savedTokens = baselineTokens - kestrelTokens;
	const topOps = [...opCounts.entries()].sort((a, b) => b[1] - a[1]);

	const result: Aggregate = {
		topOps,
		savedTokens,
		kestrelTokens,
		baselineTokens,
		queries: entries.length,
		savedPct: baselineTokens === 0 ? 0 : (savedTokens / baselineTokens) * 100
	};

	if (opts.byProject === true) {
		result.byProject = groupByProject(entries);
	}

	return result;
}

/** Group entries into per-cwd totals, sorted by descending tokens saved. */
function groupByProject(entries: GainEntry[]): ProjectTotal[] {
	const byCwd = new Map<string, ProjectTotal>();

	for (const entry of entries) {
		const total = byCwd.get(entry.cwd) ?? {
			queries: 0,
			savedTokens: 0,
			cwd: entry.cwd,
			kestrelTokens: 0,
			baselineTokens: 0
		};
		total.queries += 1;
		total.kestrelTokens += entry.kestrelTokens;
		total.baselineTokens += entry.baselineTokens;
		total.savedTokens = total.baselineTokens - total.kestrelTokens;
		byCwd.set(entry.cwd, total);
	}

	return [...byCwd.values()].sort((a, b) => b.savedTokens - a.savedTokens);
}

/** Structural check that a parsed line is a usable GainEntry. */
function isGainEntry(value: unknown): value is GainEntry {
	if (value === null || typeof value !== "object") {
		return false;
	}

	const entry = value as Record<string, unknown>;

	return (
		typeof entry.ts === "number" &&
		typeof entry.cwd === "string" &&
		typeof entry.op === "string" &&
		typeof entry.files === "number" &&
		typeof entry.kestrelTokens === "number" &&
		typeof entry.baselineTokens === "number"
	);
}
