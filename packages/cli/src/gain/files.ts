/**
 * Extract the distinct source files a query result references.
 *
 * The honest baseline for "what would the agent have read instead" is the set of
 * files appearing in the result — every `position.file` and any top-level `file`.
 * The walk is generic over result shape so it needs no per-op wiring.
 */

/** Collect every string under a `file` key anywhere in `result`, deduped and sorted. */
export function filesIn(result: unknown): string[] {
	const files = new Set<string>();

	const walk = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const item of node) {
				walk(item);
			}

			return;
		}

		if (node === null || typeof node !== "object") {
			return;
		}

		for (const [key, value] of Object.entries(node)) {
			if (key === "file" && typeof value === "string") {
				files.add(value);
			} else {
				walk(value);
			}
		}
	};

	walk(result);

	return [...files].sort();
}
