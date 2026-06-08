/**
 * Per-key single-flight serializer. ts-morph's `Project` (and the LSP client) are not
 * reentrant, so concurrent MCP tool calls on the same warm engine must not interleave.
 * `serialize(key, fn)` chains all calls sharing a key so they run one at a time, in order.
 */
const tails = new Map<string, Promise<unknown>>();

export function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const prev = tails.get(key) ?? Promise.resolve();
	// Run after the previous call settles (success OR failure), so one rejection
	// doesn't wedge the chain.
	const run = prev.then(fn, fn);

	// Keep the tail rejection-safe so the next caller still chains cleanly.
	tails.set(
		key,
		run.then(
			() => undefined,
			() => undefined
		)
	);

	return run;
}

/** Drop a key's chain (e.g. when its engine is evicted/disposed). */
export function clearSerialKey(key: string): void {
	tails.delete(key);
}
