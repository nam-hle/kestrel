import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

/**
 * Resolve the tsconfig to use. An explicit path wins. Otherwise walk up from `startDir`
 * (default: cwd) looking for the nearest `tsconfig.json`. Throws a clear error if none is
 * found — so an omitted `--tsconfig` outside a TS project fails loudly, not cryptically.
 */
export function resolveTsconfig(explicit: string | undefined, startDir: string = process.cwd()): string {
	if (explicit !== undefined && explicit !== "") {
		return explicit;
	}

	let dir = resolve(startDir);

	for (;;) {
		const candidate = join(dir, "tsconfig.json");

		if (existsSync(candidate)) {
			return candidate;
		}

		const parent = dirname(dir);

		if (parent === dir) {
			throw new Error("no tsconfig.json found from the current directory upward; pass --tsconfig <path>");
		}

		dir = parent;
	}
}
