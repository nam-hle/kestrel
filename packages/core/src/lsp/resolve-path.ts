/**
 * File-path resolution for the LSP engine, matching the ts-morph `Engine` contract:
 * callers pass paths relative to the current working directory (the same paths the
 * CLI receives), not relative to the tsconfig directory.
 *
 * Returns an absolute, forward-slashed path. A path that already resolves against cwd
 * wins; otherwise we fall back to joining it onto the project root (tsconfig dir), which
 * covers callers that pass root-relative paths. Without this, a cwd-relative path whose
 * prefix overlaps the root (e.g. `packages/core/src/x.ts` under root `.../packages/core`)
 * doubled into `.../packages/core/packages/core/src/x.ts`.
 */
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

export function resolveProjectFile(root: string, file: string): string {
	const fromCwd = resolvePath(file).replace(/\\/g, "/");

	if (existsSync(fromCwd)) {
		return fromCwd;
	}

	return resolvePath(root, file).replace(/\\/g, "/");
}
