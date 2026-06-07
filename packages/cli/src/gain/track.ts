import { statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

import { filesIn } from "./files.js";
import { record } from "./ledger.js";
import { bytesToTokens } from "./estimate.js";

/**
 * Record one query's token savings to the ledger. Called after a query result is
 * emitted, with the op label, the result object, and the project's tsconfig path.
 *
 * `kestrelTokens` is the estimate of the emitted output; `baselineTokens` is the
 * estimate of reading the distinct files the result referenced — the honest
 * alternative. Result file paths are relative to the tsconfig directory (the
 * engine's base dir), so baseline sizing resolves against that, not the cwd.
 *
 * Tracking is on by default with no opt-out — gain is observability, so any
 * failure here is swallowed and never affects the query.
 */
export function recordGain(op: string, result: unknown, emitted: string, tsconfig: string): void {
	try {
		const baseDir = dirname(resolve(tsconfig));
		const files = filesIn(result);
		const baselineBytes = files.reduce((sum, file) => sum + fileSize(join(baseDir, file)), 0);

		record({
			op,
			ts: Date.now(),
			cwd: process.cwd(),
			files: files.length,
			baselineTokens: bytesToTokens(baselineBytes),
			kestrelTokens: bytesToTokens(Buffer.byteLength(emitted, "utf8"))
		});
	} catch {
		// Observability must never break a query.
	}
}

/** Size a file on disk; unreadable → 0 bytes. */
function fileSize(absPath: string): number {
	try {
		return statSync(absPath).size;
	} catch {
		return 0;
	}
}
