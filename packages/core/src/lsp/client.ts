import { pathToFileURL } from "node:url";
/**
 * LSP transport for tsgo. Spawns `tsgo --lsp --stdio`, frames JSON-RPC with
 * Content-Length headers, and answers the server->client requests
 * (`workspace/configuration`, `client/registerCapability`) that otherwise hang the
 * handshake (observed in the Door-3 spike). Lazy: spawns on `start()`.
 */
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { tsgoBinPath } from "./tsgo-bin.js";

interface PendingResolve {
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
}

export class LspClient {
	/** Per-request ceiling; on timeout the pending promise rejects (see `request`). */
	static readonly #REQUEST_TIMEOUT_MS = 30_000;

	#child: ChildProcessWithoutNullStreams | undefined;
	#buffer = Buffer.alloc(0);
	#nextId = 1;
	readonly #pending = new Map<number, PendingResolve>();
	#started: Promise<Record<string, unknown>> | undefined;

	public constructor(private readonly root: string) {}

	/** Spawn + initialize once; resolves with the server capabilities. Idempotent. */
	public start(): Promise<Record<string, unknown>> {
		this.#started ??= this.#start();

		return this.#started;
	}

	async #start(): Promise<Record<string, unknown>> {
		const bin = tsgoBinPath();

		if (bin === undefined) {
			throw new Error("tsgo not found — install @typescript/native-preview to use the LSP engine");
		}

		const child = spawn(process.execPath, [bin, "--lsp", "--stdio"], { cwd: this.root });
		this.#child = child;
		child.stdout.on("data", (chunk: Buffer) => this.#onData(chunk));
		// Drain stderr so a full OS pipe buffer can never block tsgo's stdin processing.
		child.stderr.resume();
		child.on("exit", () => this.#rejectAll(new Error("tsgo exited")));

		const result = (await this.request("initialize", {
			processId: process.pid,
			rootUri: pathToFileURL(this.root).href,
			capabilities: {
				textDocument: {
					documentSymbol: { hierarchicalDocumentSymbolSupport: true }
				}
			}
		})) as { capabilities: Record<string, unknown> };

		this.notify("initialized", {});

		return result.capabilities;
	}

	public request(method: string, params: unknown): Promise<unknown> {
		const id = this.#nextId++;
		const promise = new Promise<unknown>((resolve, reject) => {
			this.#pending.set(id, { reject, resolve });
			// Bound the wait so a hung subprocess rejects instead of hanging the engine forever.
			const timer = setTimeout(() => {
				if (this.#pending.delete(id)) {
					reject(new Error(`tsgo LSP request timed out: ${method}`));
				}
			}, LspClient.#REQUEST_TIMEOUT_MS);
			timer.unref();
		});
		this.#send({ id, method, params, jsonrpc: "2.0" });

		return promise;
	}

	public notify(method: string, params: unknown): void {
		this.#send({ method, params, jsonrpc: "2.0" });
	}

	public async dispose(): Promise<void> {
		if (this.#child === undefined) {
			return;
		}

		try {
			await this.request("shutdown", null);
			this.notify("exit", null);
		} catch {
			// already gone
		}

		this.#child.kill();
		this.#child = undefined;
	}

	#send(message: unknown): void {
		const body = Buffer.from(JSON.stringify(message), "utf8");
		const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
		this.#child?.stdin.write(Buffer.concat([header, body]));
	}

	#onData(chunk: Buffer): void {
		this.#buffer = Buffer.concat([this.#buffer, chunk]);

		for (;;) {
			const headerEnd = this.#buffer.indexOf("\r\n\r\n");

			if (headerEnd === -1) {
				return;
			}

			const header = this.#buffer.subarray(0, headerEnd).toString("ascii");
			const match = /content-length:\s*(\d+)/i.exec(header);

			if (match === null) {
				this.#buffer = this.#buffer.subarray(headerEnd + 4);
				continue;
			}

			const length = Number(match[1]);
			const start = headerEnd + 4;

			if (this.#buffer.length < start + length) {
				return;
			}

			const body = this.#buffer.subarray(start, start + length).toString("utf8");
			this.#buffer = this.#buffer.subarray(start + length);
			this.#handle(JSON.parse(body) as { id?: number; error?: unknown; method?: string; params?: unknown; result?: unknown });
		}
	}

	#handle(message: { id?: number; error?: unknown; method?: string; params?: unknown; result?: unknown }): void {
		// Server -> client request: must reply or the handshake hangs (spike finding).
		if (message.method !== undefined && message.id !== undefined) {
			const result = message.method === "workspace/configuration" ? [{}] : null;
			this.#send({ result, jsonrpc: "2.0", id: message.id });

			return;
		}

		// Server -> client notification: ignore.
		if (message.method !== undefined) {
			return;
		}

		if (message.id === undefined) {
			return;
		}

		const pending = this.#pending.get(message.id);

		if (pending === undefined) {
			return;
		}

		this.#pending.delete(message.id);

		if (message.error !== undefined) {
			pending.reject(message.error);
		} else {
			pending.resolve(message.result);
		}
	}

	#rejectAll(error: Error): void {
		for (const pending of this.#pending.values()) {
			pending.reject(error);
		}

		this.#pending.clear();
	}
}
