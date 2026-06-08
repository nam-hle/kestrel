// Mutual recursion — exercises the call-hierarchy cycle guard. ping ↔ pong form a
// cycle reachable via two chains, so a guard keyed on node identity (rather than
// source position) can fail to dedupe and blow the tree up.
export function ping(n: number): number {
	if (n <= 0) {
		return 0;
	}
	return pong(n - 1);
}

export function pong(n: number): number {
	if (n <= 0) {
		return 0;
	}
	return ping(n - 1);
}
