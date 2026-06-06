#!/usr/bin/env node
/**
 * kestrel CLI adapter. Translates CLI args <-> @kestrel/core calls,
 * serializes results (--json). Daemon (warm) or one-shot (cold). No analysis logic.
 * See docs/DESIGN.md Section 1.
 *
 * Skeleton: entry only. Arg parsing + commands TBD.
 */
export function main(_argv: string[]): void {
	throw new Error("not implemented");
}

main(process.argv.slice(2));
