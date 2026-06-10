import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { connect, type Socket } from "node:net";

import type { EngineKind, AsyncSymbolEngine } from "@symantic/core";

import { daemonPaths } from "./paths.js";

const SPAWN_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 500;

interface DaemonConnection {
	socket: Socket;
	request: (method: string, params: unknown[]) => Promise<unknown>;
}

function connectOnce(socketPath: string): Promise<DaemonConnection | undefined> {
	return new Promise((done) => {
		const socket = connect(socketPath);
		const timer = setTimeout(() => {
			socket.destroy();
			done(undefined);
		}, CONNECT_TIMEOUT_MS);

		socket.once("error", () => {
			clearTimeout(timer);
			done(undefined);
		});

		socket.once("connect", () => {
			clearTimeout(timer);
			let buffer = "";
			let nextId = 0;
			const pending = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();

			socket.on("data", (chunk) => {
				buffer += chunk.toString("utf8");

				for (;;) {
					const newline = buffer.indexOf("\n");

					if (newline === -1) {
						return;
					}

					const line = buffer.slice(0, newline);
					buffer = buffer.slice(newline + 1);
					const message = JSON.parse(line) as { id: number; error?: string; result?: unknown };
					const waiter = pending.get(message.id);
					pending.delete(message.id);

					if (waiter === undefined) {
						continue;
					}

					if (message.error !== undefined) {
						waiter.fail(new Error(message.error));
					} else {
						waiter.ok(message.result);
					}
				}
			});

			socket.on("error", () => {
				for (const waiter of pending.values()) {
					waiter.fail(new Error("daemon connection lost"));
				}

				pending.clear();
			});

			done({
				socket,
				request: (method, params) =>
					new Promise((ok, fail) => {
						const id = nextId++;
						pending.set(id, { ok, fail });
						socket.write(`${JSON.stringify({ id, method, params })}\n`);
					})
			});
		});
	});
}

function spawnDaemon(tsConfigPath: string, engineKind: EngineKind): void {
	const bin = fileURLToPath(import.meta.url);
	const child = spawn(process.execPath, [bin, "_daemon", "--tsconfig", tsConfigPath, "--engine", engineKind], {
		detached: true,
		stdio: "ignore",
		env: process.env
	});
	child.unref();
}

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

/**
 * An AsyncSymbolEngine served by a background daemon (issue #113): connect to the daemon for
 * this (tsconfig, engine kind, version), spawning it on first use, and proxy every engine
 * call over the socket. Returns undefined — caller falls back to an in-process engine — when
 * the daemon is disabled (`SYMANTIC_NO_DAEMON`) or can't be reached in time.
 */
export async function daemonEngine(tsConfigPath: string, engineKind: EngineKind, version: string): Promise<AsyncSymbolEngine | undefined> {
	if (process.env["SYMANTIC_NO_DAEMON"] !== undefined && process.env["SYMANTIC_NO_DAEMON"] !== "") {
		return undefined;
	}

	const paths = daemonPaths(tsConfigPath, engineKind, version);
	let connection = await connectOnce(paths.socketPath);

	if (connection === undefined) {
		spawnDaemon(tsConfigPath, engineKind);
		const deadline = Date.now() + SPAWN_TIMEOUT_MS;

		while (connection === undefined && Date.now() < deadline) {
			await sleep(100);
			connection = await connectOnce(paths.socketPath);
		}
	}

	if (connection === undefined) {
		return undefined;
	}

	const { socket, request } = connection;

	return new Proxy({} as AsyncSymbolEngine, {
		get(_target, prop) {
			// `await daemonEngine(...)` probes `.then` on the proxy — it must read as a
			// plain value, not become an RPC call.
			if (prop === "then") {
				return undefined;
			}

			if (prop === "dispose") {
				// Disposing the client just closes the connection; the daemon stays warm.
				return () => {
					socket.end();

					return Promise.resolve();
				};
			}

			if (typeof prop !== "string") {
				return undefined;
			}

			return (...args: unknown[]) => request(prop, args);
		}
	});
}
