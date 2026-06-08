import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

/**
 * This package's version, read from its package.json at runtime. The bundled bin lives at
 * `dist/index.js`, so package.json is one level up. Falls back to "0.0.0" if unreadable.
 */
export function readVersion(): string {
	try {
		const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };

		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}
