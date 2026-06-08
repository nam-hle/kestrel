import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
/**
 * Integration tests for the symantic CLI adapter.
 *
 * Tests spawn the built binary (packages/cli/dist/index.js) as a child process.
 * Prerequisite: `pnpm build` must have been run before executing these tests.
 * The nadle `testUnit` task depends on `build`, so this is guaranteed in CI.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";

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

/** Run the CLI with the given args (optionally from `cwd`), returning stdout, stderr, exit code. */
async function run(args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
	try {
		const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_BIN, ...args], { cwd, timeout: 20_000 });

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

/** The sample fixture directory (contains tsconfig.json) — for tsconfig auto-discovery. */
const FIXTURE_DIR = join(__dirname, "..", "..", "..", "core", "src", "__tests__", "fixtures", "sample");

/**
 * Run the CLI with the home dir pointed at `home` so the gain ledger lands in an
 * isolated dir. `os.homedir()` reads `USERPROFILE` on Windows and `HOME` elsewhere,
 * so set both.
 */
async function runWithHome(home: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	try {
		const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_BIN, ...args], {
			timeout: 20_000,
			env: { ...process.env, HOME: home, USERPROFILE: home }
		});

		return { stdout, stderr, code: 0 };
	} catch (error) {
		const err = error as NodeJS.ErrnoException & { code?: number; stdout?: string; stderr?: string };

		return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: typeof err.code === "number" ? err.code : 1 };
	}
}

describe("CLI integration", () => {
	describe("resolve", () => {
		it("resolves a known symbol and prints text by default", async () => {
			const { code, stdout } = await run(["resolve", "--tsconfig", TSCONFIG, "src/shapes.ts:makeCircle"]);

			expect(code).toBe(0);
			expect(stdout).toContain("src/shapes.ts:makeCircle");
			expect(stdout).not.toContain('"kind"'); // no JSON field names
		}, 20_000);

		it("resolve --json returns JSON kind:symbol", async () => {
			const { code, stdout } = await run(["resolve", "--tsconfig", TSCONFIG, "src/shapes.ts:makeCircle", "--json"]);

			expect(code).toBe(0);
			const result = JSON.parse(stdout) as { kind: string };
			expect(result.kind).toBe("symbol");
		}, 20_000);

		it("returns kind:not-found for an unknown symbol (exit 0)", async () => {
			const { code, stdout } = await run(["resolve", "--tsconfig", TSCONFIG, "src/shapes.ts:Nope"]);

			// resolve always emits text and exits 0 — it's a query result, not an error
			expect(code).toBe(0);
			expect(stdout).toContain("not found");
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

	describe("view family", () => {
		it("view outline prints the compact tree", async () => {
			const { code, stdout } = await run(["view", "outline", "--tsconfig", TSCONFIG, "src/shapes.ts"]);

			expect(code).toBe(0);
			expect(stdout).toContain("Circle");
		}, 20_000);

		it("view symbol prints source verbatim (no escaped newlines) by default", async () => {
			const { code, stdout } = await run(["view", "symbol", "--tsconfig", TSCONFIG, "src/shapes.ts:makeCircle"]);

			expect(code).toBe(0);
			expect(stdout).toContain("export function makeCircle");
			expect(stdout).not.toContain("\\n"); // real newlines, not escaped
		}, 20_000);

		it("view region prints a line range", async () => {
			const { code, stdout } = await run(["view", "region", "--tsconfig", TSCONFIG, "src/shapes.ts:1-3"]);

			expect(code).toBe(0);
			expect(stdout).toContain("Shape");
		}, 20_000);

		it("view context prints labeled sections by default", async () => {
			const { code, stdout } = await run(["view", "context", "--tsconfig", TSCONFIG, "src/consumer.ts:totalArea"]);

			expect(code).toBe(0);
			expect(stdout).toContain("sig:");
			expect(stdout).toContain("types:");
			expect(stdout).toContain("Circle");
			expect(stdout).not.toContain('"qualifiedName"'); // no JSON field names
		}, 20_000);

		it("view context --json returns structured JSON", async () => {
			const { code, stdout } = await run(["view", "context", "--tsconfig", TSCONFIG, "src/consumer.ts:totalArea", "--json"]);

			expect(code).toBe(0);
			const ctx = JSON.parse(stdout) as { typeRefs: string[]; callees: unknown[] };
			expect(ctx.typeRefs).toContain("Circle");
			expect(Array.isArray(ctx.callees)).toBe(true);
		}, 20_000);
	});

	describe("find family", () => {
		it("find callees lists outgoing calls (exit 0)", async () => {
			const { code } = await run(["find", "callees", "--tsconfig", TSCONFIG, "src/consumer.ts:totalArea"]);

			expect(code).toBe(0);
		}, 20_000);

		it("find symbol searches by name", async () => {
			const { code, stdout } = await run(["find", "symbol", "--tsconfig", TSCONFIG, "makeCircle"]);

			expect(code).toBe(0);
			expect(stdout).toContain("makeCircle");
		}, 20_000);

		it("find refs prints address-first text by default", async () => {
			const { code, stdout } = await run(["find", "refs", "--tsconfig", TSCONFIG, "src/shapes.ts:makeCircle"]);

			expect(code).toBe(0);
			expect(stdout).toMatch(/src\/consumer\.ts:\d+:\d+\t/); // addr<TAB>kind, not JSON
			expect(stdout).not.toContain('"references"'); // no JSON field names
		}, 20_000);

		it("find refs --json prints structured JSON", async () => {
			const { code, stdout } = await run(["find", "refs", "--tsconfig", TSCONFIG, "src/shapes.ts:makeCircle", "--json"]);

			expect(code).toBe(0);
			const parsed = JSON.parse(stdout) as { references: unknown[] };
			expect(Array.isArray(parsed.references)).toBe(true);
		}, 20_000);
	});

	describe("tsconfig auto-discovery (--tsconfig optional)", () => {
		it("discovers the nearest tsconfig.json from cwd when --tsconfig is omitted", async () => {
			// Run from the fixture dir (which has a tsconfig.json) without --tsconfig.
			const { code, stdout } = await run(["resolve", "src/shapes.ts:makeCircle"], FIXTURE_DIR);

			expect(code).toBe(0);
			expect(stdout).toContain("src/shapes.ts:makeCircle");
		}, 20_000);
	});

	describe.skipIf(!tsgoBinAvailable())("--engine lsp", () => {
		it("resolves a symbol with the LSP engine and prints text by default", async () => {
			const { code, stdout } = await run(["resolve", "--tsconfig", TSCONFIG, "--engine", "lsp", "src/shapes.ts:makeCircle"]);

			expect(code).toBe(0);
			expect(stdout).toContain("src/shapes.ts:makeCircle");
			expect(stdout).not.toContain('"kind"');
		}, 20_000);
	});

	describe("gain", () => {
		it("records a query to the ledger and reports a summary", async () => {
			const home = mkdtempSync(join(tmpdir(), "symantic-gain-cli-"));

			const query = await runWithHome(home, ["find", "refs", "--tsconfig", TSCONFIG, "src/shapes.ts:makeCircle"]);
			expect(query.code).toBe(0);

			const ledger = readFileSync(join(home, ".symantic", "gain.jsonl"), "utf8").trim();
			expect(ledger).not.toBe("");
			expect(JSON.parse(ledger.split("\n")[0]!)).toMatchObject({ op: "find refs" });

			const gain = await runWithHome(home, ["gain"]);
			expect(gain.code).toBe(0);
			expect(gain.stdout).toContain("queries:");
			expect(gain.stdout).toContain("find refs");
		}, 20_000);
	});
});
