import { describe, expect, it } from "vitest";
import { FIXTURES } from "@sidik/shared";
import { createApp } from "../src/server.js";

/**
 * The MCP surface, spoken end to end through Hono: initialize, the
 * notification that gets no reply, tools/list, and tools/call against the
 * seeded catalogue. No network: the seeded runs answer sidik_token.
 */
const app = createApp(async function* () { /* never called here */ });
const HONEYPOT = "0x48F617e5b1B214a90800348D7944bBc0E9290Fbb";

async function rpc(body: unknown) {
  const res = await app.request("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
}

describe("MCP over Streamable HTTP", () => {
  it("initializes with tools and the two sentences a consumer gets wrong", async () => {
    const { body } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    expect(body.result.serverInfo.name).toBe("sidik");
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.instructions).toMatch(/never broadcast|do not exist on Base mainnet/i);
    expect(body.result.instructions).toMatch(/NOT a clean bill of health/);
  });

  it("acknowledges a notification with 202 and no body", async () => {
    const { status, body } = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(status).toBe(202);
    expect(body).toBeNull();
  });

  it("lists three tools whose descriptions carry the caveats", async () => {
    const { body } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["sidik_token", "sidik_catalogue", "sidik_run"]);
    for (const t of body.result.tools) expect(t.inputSchema.type).toBe("object");
    expect(body.result.tools[0].description).toMatch(/do not exist on Base mainnet/);
  });

  it("answers sidik_token from the seeded catalogue, lower-cased, never broadcast", async () => {
    const { body } = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "sidik_token", arguments: { address: HONEYPOT } } });
    const r = body.result;
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent.address).toBe(HONEYPOT.toLowerCase());
    expect(r.structuredContent.headline).toBe("FAIL");
    expect(r.structuredContent.transactionsWereBroadcast).toBe(false);
    expect(JSON.parse(r.content[0].text).verdicts.length).toBeGreaterThan(0);
  });

  it("says an unknown address was never probed rather than clean", async () => {
    const { body } = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "sidik_token", arguments: { address: "0x1111111111111111111111111111111111111111" } } });
    expect(body.result.content[0].text).toMatch(/NOT a clean bill of health/);
  });

  it("pages the catalogue and honours a filter", async () => {
    const { body } = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "sidik_catalogue", arguments: { filter: "honeypot" } } });
    const r = body.result.structuredContent;
    expect(r.total).toBeGreaterThan(0);
    expect(r.total).toBeLessThan(Object.keys(FIXTURES).length);
    for (const row of r.rows) expect(row.failing).toBe(true);
  });

  it("rejects a malformed address and an unknown tool as JSON-RPC errors, not crashes", async () => {
    const bad = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "sidik_token", arguments: { address: "nope" } } });
    expect(bad.body.result.isError).toBe(true);
    const unknown = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "sidik_nothing", arguments: {} } });
    expect(unknown.body.error.code).toBe(-32602);
    const missing = await rpc({ jsonrpc: "2.0", id: 8, method: "resources/list" });
    expect(missing.body.error.code).toBe(-32601);
  });

  it("handles a batch, replying only to requests", async () => {
    const { body } = await rpc([
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 9, method: "ping" },
    ]);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(9);
  });
});
