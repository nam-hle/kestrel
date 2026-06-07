/**
 * Resolve the tsgo launcher path. The bin is not in the `@typescript/native-preview`
 * package `exports`, so resolve via the package.json directory rather than a bin subpath.
 * Returns undefined when the dep is absent — tests gate on this.
 */
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function tsgoBinPath(): string | undefined {
	try {
		const pkg = require.resolve("@typescript/native-preview/package.json");

		return join(dirname(pkg), "bin", "tsgo.js");
	} catch {
		return undefined;
	}
}
