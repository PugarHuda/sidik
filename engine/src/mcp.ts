import type { Context } from "hono";
import type { Hex, Verdict } from "@sidik/shared";
import {
  CATALOGUE_FILTERS, FIXTURE_BLOCK, FIXTURE_COUNT, catalogueRows, filterRows, headlineOf, isCatalogueFilter, paginate,
} from "@sidik/shared";
import { getCached } from "./cache.js";
import { BASE_FORK_BLOCK } from "./forkBlock.js";
import { acquireRunSlot, MAX_CONCURRENT_RUNS } from "./concurrency.js";
import { runSidik, type RunEvent } from "./orchestrator.js";
import { log } from "./log.js";

/**
 * Sidik as a tool another agent can call.
 *
 * The Model Context Protocol's Streamable HTTP transport is JSON-RPC 2.0 over
 * POST: a client sends `initialize`, `notifications/initialized`, then
 * `tools/list` and `tools/call`. That is small enough to answer directly from
 * Hono, so this carries no SDK — every line of the protocol Sidik speaks is
 * in this file, and a test can exercise it with `app.request()`.
 *
 * Three tools, and their descriptions carry the two sentences llms.txt was
 * written for: the transactions were never broadcast, and an address with no
 * run is not a clean one. A model reading a tool description is the reader
 * most likely to skip the docs.
 *
 * Spec: https://modelcontextprotocol.io/specification (Streamable HTTP).
 */
const PROTOCOL_VERSION = "2025-06-18";
const TOKEN_RE = /^0x[0-9a-fA-F]{40}$/;

type JsonRpcId = string | number | null;
interface JsonRpcRequest { jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: Record<string, unknown> }

const NEVER_BROADCAST =
  "Every figure comes from transactions mined on an ephemeral fork of Base at block " +
  `${FIXTURE_BLOCK}; the tx hashes do not exist on Base mainnet. `;
const NOT_CLEAN = "An address with no run is NOT a clean bill of health — it was never probed.";

const TOOLS = [
  {
    name: "sidik_token",
    description:
      "The executed verdicts for one Base (chain 8453) ERC-20: bought, sold, transferred, LP pulled and owner switches thrown on a fork. " +
      NEVER_BROADCAST + NOT_CLEAN,
    inputSchema: {
      type: "object",
      required: ["address"],
      properties: { address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "Token contract address on Base." } },
    },
  },
  {
    name: "sidik_catalogue",
    description:
      `Every address Sidik has executed (${FIXTURE_COUNT} recorded), paged, with the headline per address. ` +
      "Filters: " + CATALOGUE_FILTERS.map((f) => `${f.id} (${f.label})`).join(", ") + ". " + NOT_CLEAN,
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: CATALOGUE_FILTERS.map((f) => f.id) },
        q: { type: "string", description: "Symbol or address substring.", maxLength: 100 },
        page: { type: "integer", minimum: 1 },
      },
    },
  },
  {
    name: "sidik_run",
    description:
      "Execute the probes against a Base address NOW on a fresh fork and return the verdicts. Minutes, not seconds; " +
      `the engine allows ${MAX_CONCURRENT_RUNS} runs at once and refuses beyond that. A finished run is then also served by sidik_token. ` +
      NEVER_BROADCAST,
    inputSchema: {
      type: "object",
      required: ["address"],
      properties: { address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } },
    },
  },
] as const;

interface CachedRun { scan: { symbol: string; venue?: string }; ids: string[]; verdicts: Verdict[]; narration: string }

function tokenResult(address: string) {
  const run = getCached<CachedRun>(address, BASE_FORK_BLOCK);
  if (!run) {
    return {
      isError: false,
      content: [{ type: "text", text: `No run for ${address} at block ${BASE_FORK_BLOCK}. ${NOT_CLEAN} Call sidik_run to execute one.` }],
    };
  }
  const body = {
    address: address.toLowerCase(), chainId: 8453, forkBlock: Number(BASE_FORK_BLOCK), symbol: run.scan.symbol,
    headline: headlineOf(run.verdicts), verdicts: run.verdicts, narration: run.narration, transactionsWereBroadcast: false,
  };
  return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
}

function catalogueResult(params: Record<string, unknown>) {
  const rawFilter = typeof params.filter === "string" ? params.filter : "all";
  const filter = isCatalogueFilter(rawFilter) ? rawFilter : "all";
  const query = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const page = paginate(filterRows(catalogueRows(), { filter, query }), Number(params.page) || 1);
  const body = {
    forkBlock: Number(BASE_FORK_BLOCK), filter, query: query || null, page: page.page, pageCount: page.pageCount, total: page.total,
    rows: page.rows.map((r) => ({ address: r.address, symbol: r.symbol, headline: r.headline, venue: r.venue ?? null, failing: r.headline === "FAIL" })),
  };
  return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
}

async function runResult(address: string) {
  const release = acquireRunSlot();
  if (!release) {
    return { isError: true, content: [{ type: "text", text: `Engine is busy: ${MAX_CONCURRENT_RUNS} runs already in flight. Try again shortly.` }] };
  }
  try {
    const verdicts: Verdict[] = [];
    let narration = "";
    let error: string | undefined;
    let symbol = "";
    for await (const ev of runSidik(address as Hex) as AsyncGenerator<RunEvent>) {
      if (ev.type === "verdict") verdicts.push(ev.verdict);
      else if (ev.type === "narration") narration = ev.text;
      else if (ev.type === "prescan") symbol = ev.scan.symbol;
      else if (ev.type === "error") error = ev.message;
    }
    if (error && verdicts.length === 0) return { isError: true, content: [{ type: "text", text: error }] };
    const body = {
      address: address.toLowerCase(), chainId: 8453, forkBlock: Number(BASE_FORK_BLOCK), symbol,
      headline: headlineOf(verdicts), verdicts, narration, transactionsWereBroadcast: false, ...(error ? { error } : {}),
    };
    return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
  } finally {
    release();
  }
}

async function callTool(name: string, params: Record<string, unknown>) {
  const address = typeof params.address === "string" ? params.address : "";
  switch (name) {
    case "sidik_token":
      if (!TOKEN_RE.test(address)) return { isError: true, content: [{ type: "text", text: "address must be 0x followed by 40 hex characters" }] };
      return tokenResult(address);
    case "sidik_catalogue":
      return catalogueResult(params);
    case "sidik_run":
      if (!TOKEN_RE.test(address)) return { isError: true, content: [{ type: "text", text: "address must be 0x followed by 40 hex characters" }] };
      return runResult(address);
    default:
      return undefined;
  }
}

const rpcError = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

/** One JSON-RPC message in, one out (or nothing, for a notification). */
async function handleMcpMessage(msg: JsonRpcRequest): Promise<unknown | undefined> {
  const id = msg.id ?? null;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(id, -32600, "invalid request");
  // Notifications carry no id and get no reply.
  if (msg.method.startsWith("notifications/")) return undefined;
  switch (msg.method) {
    case "initialize":
      return {
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "sidik", version: "1" },
          instructions:
            "Sidik proves what a Base token does to a buyer by executing it on a fork. " + NEVER_BROADCAST + NOT_CLEAN,
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const started = performance.now();
      const result = await callTool(name, args);
      if (!result) return rpcError(id, -32602, `unknown tool: ${name}`);
      log.info({ event: "mcp.call", token: typeof args.address === "string" ? args.address : name, count: Math.round(performance.now() - started) });
      return { jsonrpc: "2.0", id, result };
    }
    default:
      return rpcError(id, -32601, `method not found: ${msg.method}`);
  }
}

/** Hono handler for POST /mcp (Streamable HTTP, JSON responses). */
export async function mcpPost(c: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(rpcError(null, -32700, "parse error"), 400);
  }
  const messages = Array.isArray(body) ? body : [body];
  const replies: unknown[] = [];
  for (const m of messages) {
    const reply = await handleMcpMessage(m as JsonRpcRequest);
    if (reply !== undefined) replies.push(reply);
  }
  // A batch of nothing but notifications is acknowledged with no body.
  if (replies.length === 0) return c.body(null, 202);
  return c.json(Array.isArray(body) ? replies : replies[0]);
}

/** GET /mcp: this server does not open a server-initiated stream. */
export function mcpGet(c: Context): Response {
  return c.text("Sidik MCP: POST JSON-RPC 2.0 messages here (Streamable HTTP). No server-initiated stream.", 405);
}
