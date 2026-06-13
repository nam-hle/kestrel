import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { type Socket, type Server, createServer } from "node:net";

import { createEngine } from "@symantic/core";
import type { EngineKind } from "@symantic/core";

import { daemonPaths } from "./paths.js";

/** One request over the daemon socket: an AsyncSymbolEngine method call, or "ping"/"shutdown". */
interface DaemonRequest {
	id: number;
	method: string;
	params: unknown[];
}

export interface DaemonServerOptions {
	version: string;
	/** Exit after this long without a request. Default 10 minutes. */
	idleMs?: number;
	tsConfigPath: string;
	engineKind: EngineKind;
}

const DEFAULT_IDLE_MS = 10 * 60 * 1000;

/**
 * The daemon process body: hold one warm engine for (tsconfig, engine kind) and answer
 * AsyncSymbolEngine calls over a local socket, newline-delimited JSON. Refreshes the
 * project before each call so edits between CLI invocations are seen; recreates the
 * engine once when a file is missing from the warm project (a newly created file).
 * Exits on idle timeout or an explicit "shutdown".
 */
export async function runDaemonServer(options: DaemonServerOptions): Promise<void> {
	const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
	const paths = daemonPaths(options.tsConfigPath, options.engineKind, options.version);
	let engine = createEngine({ engine: options.engineKind, tsConfigPath: options.tsConfigPath });
	// Engine calls are not reentrant — chain them so concurrent clients never interleave.
	let tail: Promise<unknown> = Promise.resolve();

	let idleTimer: NodeJS.Timeout;
	const shutdown = (server: Server): void => {
		server.close();
		void engine.dispose().then(() => {
			try {
				unlinkSync(paths.metaPath);
			} catch {
				// best-effort cleanup
			}

			// eslint-disable-next-line n/no-process-exit -- daemon shutdown: open client sockets must not keep the process alive
			process.exit(0);
		});
	};

	const callEngine = async (method: string, params: unknown[]): Promise<unknown> => {
		const target = engine as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

		if (typeof target[method] !== "function" || method === "dispose") {
			throw new Error(`unknown method: ${method}`);
		}

		await engine.refreshIfStale();

		try {
			return await target[method](...params);
		} catch (error) {
			// A file created after the project was loaded isn't in the warm project —
			// rebuild once and retry before giving up.
			if (error instanceof Error && error.message.includes("file not found in project")) {
				await engine.dispose();
				engine = createEngine({ engine: options.engineKind, tsConfigPath: options.tsConfigPath });
				const fresh = engine as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

				return fresh[method]!(...params);
			}

			throw error;
		}
	};

	const handle = (socket: Socket, request: DaemonRequest, server: Server): void => {
		const reply = (payload: object): void => {
			socket.write(`${JSON.stringify({ id: request.id, ...payload })}\n`);
		};

		if (request.method === "ping") {
			reply({ result: { pid: process.pid, version: options.version } });

			return;
		}

		if (request.method === "shutdown") {
			reply({ result: true });
			shutdown(server);

			return;
		}

		tail = tail.then(
			() =>
				callEngine(request.method, request.params).then(
					(result) => reply({ result: result ?? null }),
					(error: unknown) => reply({ error: error instanceof Error ? error.message : String(error) })
				),
			() => undefined
		);
	};

	await new Promise<void>((ready, failed) => {
		const server = createServer((socket) => {
			let buffer = "";
			socket.on("data", (chunk) => {
				clearTimeout(idleTimer);
				idleTimer = setTimeout(() => shutdown(server), idleMs);
				buffer += chunk.toString("utf8");

				for (;;) {
					const newline = buffer.indexOf("\n");

					if (newline === -1) {
						return;
					}

					const line = buffer.slice(0, newline);
					buffer = buffer.slice(newline + 1);

					try {
						handle(socket, JSON.parse(line) as DaemonRequest, server);
					} catch {
						socket.write(`${JSON.stringify({ id: -1, error: "malformed request" })}\n`);
					}
				}
			});
			socket.on("error", () => socket.destroy());
		});

		server.on("error", failed);
		mkdirSync(paths.dir, { recursive: true });

		if (process.platform !== "win32") {
			try {
				unlinkSync(paths.socketPath);
			} catch {
				// no stale socket
			}
		}

		server.listen(paths.socketPath, () => {
			writeFileSync(paths.metaPath, JSON.stringify({ pid: process.pid, version: options.version }));
			idleTimer = setTimeout(() => shutdown(server), idleMs);
			ready();
		});
	});
}
