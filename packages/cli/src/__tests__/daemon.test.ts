import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { mkdirSync, existsSync, mkdtempSync, readdirSync, copyFileSync, readFileSync, appendFileSync } from "node:fs";

import { it, expect, describe, afterEach } from "vitest";

/**
 * CLI daemon tests (issue #113): the CLI keeps a warm engine in a background daemon keyed by
 * (tsconfig, engine kind), so repeat invocations skip the full project load. Each test uses an
 * isolated HOME so daemons (sockets, meta files) never collide with the user's.
 */
const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLI_BIN = join(__dirname, "..", "..", "dist", "index.js");
const SAMPLE_DIR = join(__dirname, "..", "..", "..", "core", "src", "__tests__", "fixtures", "sample");

interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** Run the CLI with HOME pointed at `home` (daemon state lands under `home`/.symantic). */
async function runDaemonized(home: string, args: string[], cwd?: string): Promise<RunResult> {
	try {
		const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_BIN, ...args], {
			cwd,
			timeout: 30_000,
			env: { ...process.env, HOME: home, USERPROFILE: home, SYMANTIC_DAEMON_IDLE_MS: "60000" }
		});

		return { stdout, stderr, code: 0 };
	} catch (error) {
		const err = error as NodeJS.ErrnoException & { code?: number; stdout?: string; stderr?: string };

		return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: typeof err.code === "number" ? err.code : 1 };
	}
}

/** Read every daemon meta file under `home` and return the recorded pids. */
function daemonPids(home: string): number[] {
	const dir = join(home, ".symantic", "daemon");

	if (!existsSync(dir)) {
		return [];
	}

	return readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.map((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as { pid: number }).pid);
}

/** Kill any daemons recorded under `home` so tests never leak processes. */
function killDaemons(home: string): void {
	for (const pid of daemonPids(home)) {
		try {
			process.kill(pid);
		} catch {
			// already gone
		}
	}
}

describe("CLI daemon", () => {
	const homes: string[] = [];

	function freshHome(): string {
		const home = mkdtempSync(join(tmpdir(), "symantic-daemon-"));
		homes.push(home);

		return home;
	}

	afterEach(() => {
		for (const home of homes.splice(0)) {
			killDaemons(home);
		}
	});

	it("reuses one warm daemon across invocations", async () => {
		const home = freshHome();

		const first = await runDaemonized(home, ["find", "symbol", "makeCircle"], SAMPLE_DIR);
		expect(first.code).toBe(0);
		expect(first.stdout).toContain("makeCircle");

		const pidsAfterFirst = daemonPids(home);
		expect(pidsAfterFirst).toHaveLength(1);

		const second = await runDaemonized(home, ["find", "symbol", "makeCircle"], SAMPLE_DIR);
		expect(second.code).toBe(0);
		expect(second.stdout).toContain("makeCircle");

		// Same daemon, not a new one per invocation.
		expect(daemonPids(home)).toEqual(pidsAfterFirst);
	}, 60_000);

	it("sees edits made between invocations (staleness)", async () => {
		const home = freshHome();
		// Work on a private copy of the fixture so the shared one is never mutated.
		const proj = mkdtempSync(join(tmpdir(), "symantic-daemon-proj-"));
		mkdirSync(join(proj, "src"), { recursive: true });
		copyFileSync(join(SAMPLE_DIR, "tsconfig.json"), join(proj, "tsconfig.json"));
		copyFileSync(join(SAMPLE_DIR, "src", "square.ts"), join(proj, "src", "square.ts"));

		const before = await runDaemonized(home, ["find", "symbol", "freshlyAdded"], proj);
		expect(before.code).toBe(0);
		expect(before.stdout).not.toContain("freshlyAdded");

		appendFileSync(join(proj, "src", "square.ts"), "\nexport const freshlyAdded = 1;\n");

		const after = await runDaemonized(home, ["find", "symbol", "freshlyAdded"], proj);
		expect(after.code).toBe(0);
		expect(after.stdout).toContain("freshlyAdded");
	}, 60_000);

	it("SYMANTIC_NO_DAEMON=1 bypasses the daemon entirely", async () => {
		const home = freshHome();

		const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_BIN, "find", "symbol", "makeCircle"], {
			cwd: SAMPLE_DIR,
			timeout: 30_000,
			env: { ...process.env, HOME: home, USERPROFILE: home, SYMANTIC_NO_DAEMON: "1" }
		});

		expect(`${stdout}${stderr}`).toContain("makeCircle");
		expect(daemonPids(home)).toHaveLength(0);
	}, 60_000);
});
