import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
/**
 * Integration tests for the kestrel CLI adapter.
 *
 * Tests spawn the built binary (packages/cli/dist/index.js) as a child process.
 * Prerequisite: `pnpm build` must have been run before executing these tests.
 * The nadle `testUnit` task depends on `build`, so this is guaranteed in CI.
 */
import { execFile } from "node:child_process";

import { it, expect, describe } from "vitest";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to the CLI entry point built artifact. */
const CLI_BIN = join(__dirname, "..", "..", "dist", "index.js");

/** Absolute path to the sample fixture tsconfig. */
const TSCONFIG = join(__dirname, "..", "..", "..", "core", "src", "__tests__", "fixtures", "sample", "tsconfig.json");

/** Check whether the tsgo binary is available for LSP engine tests. */
function tsgoBinAvailable(): boolean {
	const require = createRequire(import.meta.url);

	try {
		require.resolve("@typescript/native-preview/package.json");

		return true;
	} catch {
		return false;
	}
}

/** Run the CLI with the given args, returning stdout, stderr, and exit code. */
async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	try {
		const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_BIN, ...args], { timeout: 20_000 });

		return { stdout, stderr, code: 0 };
	} catch (error) {
		const err = error as NodeJS.ErrnoException & { code?: number; stdout?: string; stderr?: string };

		return {
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
			code: typeof err.code === "number" ? err.code : 1
		};
	}
}

describe("CLI integration", () => {
	describe("resolve", () => {
		it("resolves a known symbol and returns JSON kind:symbol", async () => {
			const { code, stdout } = await run(["resolve", "--tsconfig", TSCONFIG, "src/shapes.ts:makeCircle"]);

			expect(code).toBe(0);
			const result = JSON.parse(stdout) as { kind: string };
			expect(result.kind).toBe("symbol");
		}, 20_000);

		it("returns kind:not-found for an unknown symbol (exit 0)", async () => {
			const { code, stdout } = await run(["resolve", "--tsconfig", TSCONFIG, "src/shapes.ts:Nope"]);

			// resolve always emits JSON and exits 0 — it's a query result, not an error
			expect(code).toBe(0);
			const result = JSON.parse(stdout) as { kind: string };
			expect(result.kind).toBe("not-found");
		}, 20_000);
	});

	describe("def (definition)", () => {
		it("returns non-zero exit and clean stderr (no stack trace) for a missing symbol", async () => {
			const { code, stderr } = await run(["def", "--tsconfig", TSCONFIG, "src/shapes.ts:Nope"]);

			expect(code).not.toBe(0);
			// Clean error: no "at " stack trace frames
			expect(stderr).not.toMatch(/\bat\s+\S/);
		}, 20_000);
	});

	describe("outline-file", () => {
		it("exits 0 and emits a compact tree containing Circle", async () => {
			const { code, stdout } = await run(["outline-file", "--tsconfig", TSCONFIG, "src/shapes.ts"]);

			expect(code).toBe(0);
			expect(stdout).toContain("Circle");
		}, 20_000);
	});

	describe("missing required --tsconfig", () => {
		it("exits non-zero when --tsconfig is omitted", async () => {
			const { code } = await run(["resolve", "src/shapes.ts:makeCircle"]);

			expect(code).not.toBe(0);
		}, 10_000);
	});

	describe.skipIf(!tsgoBinAvailable())("--engine lsp", () => {
		it("resolves a symbol with the LSP engine and returns JSON kind:symbol", async () => {
			const { code, stdout } = await run(["resolve", "--tsconfig", TSCONFIG, "--engine", "lsp", "src/shapes.ts:makeCircle"]);

			expect(code).toBe(0);
			const result = JSON.parse(stdout) as { kind: string };
			expect(result.kind).toBe("symbol");
		}, 20_000);
	});
});
