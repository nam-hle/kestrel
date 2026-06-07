import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
/**
 * Integration tests for the kestrel MCP server adapter.
 *
 * Tests spawn the built binary (packages/mcp/dist/index.js) and speak the MCP
 * wire protocol over stdio. The MCP SDK's StdioServerTransport uses newline-
 * delimited JSON (one JSON object per line), NOT Content-Length framing.
 *
 * Prerequisite: `pnpm build` must have been run before executing these tests.
 */
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { it, expect, afterAll, describe } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MCP_BIN = join(__dirname, "..", "..", "dist", "index.js");
const TSCONFIG = join(__dirname, "..", "..", "..", "core", "src", "__tests__", "fixtures", "sample", "tsconfig.json");

// ---------------------------------------------------------------------------
// Minimal newline-delimited JSON-RPC client (matches MCP SDK StdioServerTransport)
// ---------------------------------------------------------------------------

interface JsonRpcResponse {
	jsonrpc: "2.0";
	error?: unknown;
	method?: string;
	result?: unknown;
	id?: number | string;
}

class McpClient {
	readonly #child: ChildProcessWithoutNullStreams;
	#lineBuffer = "";
	#nextId = 1;
	readonly #pending = new Map<number, { reject: (e: unknown) => void; resolve: (v: unknown) => void }>();

	public constructor() {
		this.#child = spawn(process.execPath, [MCP_BIN], { stdio: ["pipe", "pipe", "pipe"] });
		this.#child.stdout.on("data", (chunk: Buffer) => this.#onData(chunk));
		// Drain stderr so a full pipe never blocks the server
		this.#child.stderr.resume();
		this.#child.on("exit", () => {
			for (const p of this.#pending.values()) {
				p.reject(new Error("MCP server exited unexpectedly"));
			}

			this.#pending.clear();
		});
	}

	public request(method: string, params: unknown): Promise<unknown> {
		const id = this.#nextId++;
		const promise = new Promise<unknown>((resolve, reject) => {
			this.#pending.set(id, { reject, resolve });
			const timer = setTimeout(() => {
				if (this.#pending.delete(id)) {
					reject(new Error(`MCP request timed out: ${method}`));
				}
			}, 20_000);
			timer.unref();
		});

		const msg = JSON.stringify({ id, method, params, jsonrpc: "2.0" });
		this.#child.stdin.write(`${msg}\n`);

		return promise;
	}

	#onData(chunk: Buffer): void {
		this.#lineBuffer += chunk.toString("utf8");

		let newlineIdx: number;

		// Process all complete lines
		while ((newlineIdx = this.#lineBuffer.indexOf("\n")) !== -1) {
			const line = this.#lineBuffer.slice(0, newlineIdx).trimEnd();
			this.#lineBuffer = this.#lineBuffer.slice(newlineIdx + 1);

			if (line.length === 0) {
				continue;
			}

			let msg: JsonRpcResponse;

			try {
				msg = JSON.parse(line) as JsonRpcResponse;
			} catch {
				continue;
			}

			// Server-initiated notifications / requests — ignore for now
			if (msg.method !== undefined) {
				continue;
			}

			const numericId = typeof msg.id === "number" ? msg.id : undefined;

			if (numericId === undefined) {
				continue;
			}

			const pending = this.#pending.get(numericId);

			if (pending === undefined) {
				continue;
			}

			this.#pending.delete(numericId);

			if (msg.error !== undefined) {
				pending.reject(msg.error);
			} else {
				pending.resolve(msg.result);
			}
		}
	}

	public dispose(): void {
		this.#child.kill();
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCP server integration", () => {
	let client: McpClient;

	afterAll(() => {
		client?.dispose();
	});

	it("responds to initialize with serverInfo name 'kestrel'", async () => {
		client = new McpClient();

		const result = (await client.request("initialize", {
			capabilities: {},
			protocolVersion: "2024-11-05",
			clientInfo: { version: "0.0.0", name: "kestrel-test" }
		})) as { serverInfo?: { name?: string } };

		expect(result.serverInfo?.name).toBe("kestrel");
	}, 20_000);

	it("tools/list exposes the view_* / find_* tool names", async () => {
		const result = (await client.request("tools/list", {})) as { tools: { name: string }[] };

		const names = result.tools.map((t) => t.name);
		expect(names).toContain("view_outline");
		expect(names).toContain("view_symbol");
		expect(names).toContain("view_context");
		expect(names).toContain("view_region");
		expect(names).toContain("find_refs");
		expect(names).toContain("find_callers");
		expect(names).toContain("find_callees");
		expect(names).toContain("exports");
		// old flat names are gone (no back-compat aliases pre-publish)
		expect(names).not.toContain("outline_file");
		expect(names).not.toContain("usages");
		expect(names).not.toContain("calls");
	}, 20_000);

	it("tools/call resolve returns text by default (address-first)", async () => {
		const result = (await client.request("tools/call", {
			name: "resolve",
			arguments: { tsConfig: TSCONFIG, symbol: "src/shapes.ts:makeCircle" }
		})) as { content: { type: string; text: string }[] };

		expect(result.content[0]?.type).toBe("text");
		// text format: qualifiedName<TAB>L<line>
		expect(result.content[0]!.text).toContain("src/shapes.ts:makeCircle");
		expect(result.content[0]!.text).not.toContain("{");
	}, 20_000);

	it("tools/call resolve with json:true returns kind:symbol", async () => {
		const result = (await client.request("tools/call", {
			name: "resolve",
			arguments: { json: true, tsConfig: TSCONFIG, symbol: "src/shapes.ts:makeCircle" }
		})) as { content: { type: string; text: string }[] };

		expect(result.content[0]?.type).toBe("text");
		const parsed = JSON.parse(result.content[0]!.text) as { kind: string };
		expect(parsed.kind).toBe("symbol");
	}, 20_000);

	it("tools/call view_symbol returns the declaration source", async () => {
		const result = (await client.request("tools/call", {
			name: "view_symbol",
			arguments: { tsConfig: TSCONFIG, symbol: "src/shapes.ts:makeCircle" }
		})) as { content: { type: string; text: string }[] };

		expect(result.content[0]!.text).toContain("makeCircle");
	}, 20_000);

	it("tools/call find_refs returns text by default", async () => {
		const result = (await client.request("tools/call", {
			name: "find_refs",
			arguments: { tsConfig: TSCONFIG, symbol: "src/shapes.ts:makeCircle" }
		})) as { content: { type: string; text: string }[] };
		expect(result.content[0]!.text).toMatch(/src\/consumer\.ts:\d+:\d+\t/);
		expect(result.content[0]!.text).not.toContain("{");
	}, 20_000);

	it("tools/call find_refs with json:true returns JSON", async () => {
		const result = (await client.request("tools/call", {
			name: "find_refs",
			arguments: { json: true, tsConfig: TSCONFIG, symbol: "src/shapes.ts:makeCircle" }
		})) as { content: { type: string; text: string }[] };
		const parsed = JSON.parse(result.content[0]!.text) as { references: unknown[] };
		expect(Array.isArray(parsed.references)).toBe(true);
	}, 20_000);
});
