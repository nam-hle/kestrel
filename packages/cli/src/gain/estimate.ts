/**
 * Token estimation heuristic for the `gain` command.
 *
 * kestrel reports estimated token savings without a real tokenizer (zero deps,
 * deterministic). The chars/4 rule is the single documented heuristic; every
 * reported figure is `~`-prefixed to flag it as an estimate. See
 * docs/superpowers/specs/2026-06-07-gain-command-design.md.
 */

/** Estimate the token count of `bytes` of UTF-8 text as `ceil(bytes / 4)`. */
export function bytesToTokens(bytes: number): number {
	return Math.ceil(bytes / 4);
}
