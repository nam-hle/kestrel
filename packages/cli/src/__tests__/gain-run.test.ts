import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

import { it, expect, describe, afterEach, beforeEach } from "vitest";

import { gain } from "../gain/command.js";
import { record, ledgerPath } from "../gain/ledger.js";

/** Capture everything written to process.stdout during `fn`. */
function captureStdout(fn: () => void): string {
	const chunks: string[] = [];
	const orig = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((s: string) => {
		chunks.push(s);

		return true;
	}) as typeof process.stdout.write;

	try {
		fn();
	} finally {
		process.stdout.write = orig;
	}

	return chunks.join("");
}

/** Invoke the (synchronous) gain command's run with a parsed-args shape, capturing stdout. */
function run(args: Record<string, unknown>): string {
	return captureStdout(() => {
		void (gain.run as (ctx: { args: Record<string, unknown> }) => void)({ args });
	});
}

describe("gain command run", () => {
	let origHome: string | undefined;
	let origUserProfile: string | undefined;

	beforeEach(() => {
		const home = mkdtempSync(join(tmpdir(), "symantic-gain-run-"));
		// homedir() reads HOME on POSIX, USERPROFILE on Windows. Set both so the test is hermetic
		// on every platform.
		origHome = process.env.HOME;
		origUserProfile = process.env.USERPROFILE;
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		// Seed two entries in the temp ledger.
		const path = ledgerPath();
		record({ ts: 1, files: 2, cwd: "/proj", op: "find refs", symanticTokens: 20, baselineTokens: 100 }, path);
		record({ ts: 2, files: 1, cwd: "/proj", op: "view outline", baselineTokens: 40, symanticTokens: 10 }, path);
	});

	afterEach(() => {
		if (origHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = origHome;
		}

		if (origUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = origUserProfile;
		}
	});

	it("prints the summary by default", () => {
		const out = run({});
		expect(out).toContain("saved");
	});

	it("prints recent history with --history", () => {
		const out = run({ history: true });
		expect(out).toContain("find refs");
		expect(out).toContain("view outline");
	});

	it("prints the by-project grouping with --by-project", () => {
		const out = run({ "by-project": true });
		expect(out).toContain("/proj");
	});

	it("emits the machine-readable aggregate with --json", () => {
		const out = run({ json: true });
		const agg = JSON.parse(out) as { queries: number };
		expect(agg.queries).toBe(2);
	});
});
