import { createHash } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Daemon addressing. One daemon per (tsconfig, engine kind, CLI version); the key hashes
 * all three so a version bump or different project never talks to a stale daemon. State:
 *
 * - meta file `~/.symantic/daemon/<key>.json` ({ pid }) — cross-platform observable, lets
 *   callers find/kill the daemon.
 * - endpoint: a unix socket next to the meta file, or a named pipe on Windows (named pipes
 *   are not filesystem entries, so the pipe name embeds the key instead).
 */
export interface DaemonPaths {
	key: string;
	dir: string;
	metaPath: string;
	socketPath: string;
}

export function daemonPaths(tsConfigPath: string, engineKind: string, version: string): DaemonPaths {
	// HOME is part of the key so isolated HOMEs (tests) never share a daemon.
	const key = createHash("sha256")
		.update(`${homedir()}::${resolve(tsConfigPath)}::${engineKind}::${version}`)
		.digest("hex")
		.slice(0, 16);
	const dir = join(homedir(), ".symantic", "daemon");
	// The socket lives in tmpdir, not under HOME: macOS caps unix socket paths at ~104
	// bytes, which a deep HOME (or tmp test HOME) easily exceeds.
	const socketPath = process.platform === "win32" ? `\\\\.\\pipe\\symantic-${key}` : join(tmpdir(), `symantic-${key}.sock`);

	return { key, dir, socketPath, metaPath: join(dir, `${key}.json`) };
}
