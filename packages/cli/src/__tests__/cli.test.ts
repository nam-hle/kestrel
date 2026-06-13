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
		// Daemon-free: these tests exercise the in-process path; daemon behavior is covered in daemon.test.ts.
		const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_BIN, ...args], {
			cwd,
			timeout: 20_000,
			env: { ...process.env, SYMANTIC_NO_DAEMON: "1" }
		});

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
			env: { ...process.env, HOME: home, USERPROFILE: home, SYMANTIC_NO_DAEMON: "1" }
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

		it("view file --body prints each export's source", async () => {
			const { code, stdout } = await run(["view", "file", "--tsconfig", TSCONFIG, "src/nested.ts", "--body"]);

			expect(code).toBe(0);
			expect(stdout).toContain("export namespace Model");
		}, 20_000);

		it("view file --body prints each namespace member exactly once", async () => {
			const { code, stdout } = await run(["view", "file", "--tsconfig", TSCONFIG, "src/nested.ts", "--body"]);

			expect(code).toBe(0);
			// Members nested in namespaces appear only inside their namespace's source,
			// never re-printed standalone.
			expect(stdout.match(/deep: boolean/g)).toHaveLength(1);
			expect(stdout.match(/live: boolean/g)).toHaveLength(1);
		}, 20_000);

		it("view body --source prints the function source instead of the skeleton", async () => {
			const { code, stdout } = await run(["view", "body", "--tsconfig", TSCONFIG, "src/consumer.ts:totalArea", "--source"]);

			expect(code).toBe(0);
			expect(stdout).toContain("export function totalArea");
			expect(stdout).not.toContain("ForStatement"); // skeleton node kinds absent
		}, 20_000);

		it("view body hints at --source when the skeleton is short", async () => {
			const { code, stderr } = await run(["view", "body", "--tsconfig", TSCONFIG, "src/consumer.ts:describeArea"]);

			expect(code).toBe(0);
			expect(stderr).toContain("--source");
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

		it("find symbol hints toward view outline for a filename-shaped query", async () => {
			const { code, stderr } = await run(["find", "symbol", "--tsconfig", TSCONFIG, "some-missing-module"]);

			expect(code).toBe(0);
			expect(stderr).toContain("view outline");
		}, 20_000);

		it("find def hints toward :: when a member is addressed with a dot (#101)", async () => {
			const { code, stderr } = await run(["find", "def", "--tsconfig", TSCONFIG, "src/nested.ts:Model.Node"]);

			expect(code).toBe(1);
			expect(stderr).toContain("Model::Node");
			expect(stderr).toContain("::");
		}, 20_000);

		it("find def hints --engine lsp for an external import the default engine can't follow (#100)", async () => {
			const { code, stderr } = await run(["find", "def", "--tsconfig", TSCONFIG, "src/external.ts:Node"]);

			expect(code).toBe(1);
			expect(stderr).toContain("--engine lsp");
			expect(stderr).toContain("ts-morph");
		}, 20_000);

		it("find refs prints address-first text by default", async () => {
			const { code, stdout } = await run(["find", "refs", "--tsconfig", TSCONFIG, "src/shapes.ts:makeCircle"]);

			expect(code).toBe(0);
			expect(stdout).toMatch(/^src\/ {2}\(\d+\)$/m); // per-dir group header with count
			expect(stdout).toMatch(/^ {2}consumer\.ts:\d+:\d+\t/m); // indented basename row, addr<TAB>kind
			expect(stdout).not.toContain('"references"'); // no JSON field names
		}, 20_000);

		it("find refs --json prints structured JSON", async () => {
			const { code, stdout } = await run(["find", "refs", "--tsconfig", TSCONFIG, "src/shapes.ts:makeCircle", "--json"]);

			expect(code).toBe(0);
			const parsed = JSON.parse(stdout) as { references: unknown[] };
			expect(Array.isArray(parsed.references)).toBe(true);
		}, 20_000);
	});

	describe("--version", () => {
		it("prints the package version (semver), not 0.0.0", async () => {
			const { code, stdout } = await run(["--version"]);

			expect(code).toBe(0);
			expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
			expect(stdout.trim()).not.toBe("0.0.0");
		}, 10_000);
	});

	describe("0-file project warning", () => {
		const BASE_CONFIG_DIR = join(__dirname, "..", "..", "..", "core", "src", "__tests__", "fixtures", "base-config");

		it("warns on stderr when the discovered tsconfig yields no source files", async () => {
			const { code, stderr } = await run(["find", "symbol", "fooMarker"], BASE_CONFIG_DIR);

			expect(code).toBe(0);
			expect(stderr).toContain("0 source files");
			expect(stderr).toContain("--tsconfig");
		}, 20_000);

		it("does not warn for a project with source files", async () => {
			const { stderr } = await run(["find", "symbol", "makeCircle", "--tsconfig", TSCONFIG]);

			expect(stderr).not.toContain("0 source files");
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

		it("view file --body prints each namespace member exactly once (lsp)", async () => {
			const { code, stdout } = await run(["view", "file", "--tsconfig", TSCONFIG, "--engine", "lsp", "src/nested.ts", "--body"]);

			expect(code).toBe(0);
			expect(stdout).toContain("export namespace Model");
			expect(stdout.match(/deep: boolean/g)).toHaveLength(1);
			expect(stdout.match(/live: boolean/g)).toHaveLength(1);
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
