import { test, expect } from "@playwright/test";

/**
 * The hosted MCP endpoint.
 *
 * The protocol itself is tested in the engine; what is tested here is that the
 * deployed site actually speaks it, because "an agent can call a fork
 * execution instead of a scanner" was true only on a machine somebody ran
 * themselves until this route existed.
 */
const rpc = (method: string, params?: unknown, id: number | null = 1) =>
  ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });

test.describe("MCP over Streamable HTTP", () => {
  test("initializes and advertises the three tools", async ({ request }) => {
    const init = await (await request.post("/api/mcp", { data: rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } }) })).json();
    expect(init.result.serverInfo.name).toBe("sidik");

    const list = await (await request.post("/api/mcp", { data: rpc("tools/list", undefined, 2) })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name).sort())
      .toEqual(["sidik_catalogue", "sidik_run", "sidik_token"]);
  });

  // The refusal the whole project turns on, restated for the reader most
  // likely to skip the documentation: a model.
  test("tells an agent that an unprobed address is not a clean one", async ({ request }) => {
    const res = await (await request.post("/api/mcp", {
      data: rpc("tools/call", { name: "sidik_token", arguments: { address: "0x1111111111111111111111111111111111111111" } }, 3),
    })).json();
    expect(res.result.content[0].text).toMatch(/NOT a clean bill of health/i);
  });

  test("serves a recorded run as structured data", async ({ request }) => {
    const res = await (await request.post("/api/mcp", {
      data: rpc("tools/call", { name: "sidik_token", arguments: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } }, 4),
    })).json();
    const body = JSON.parse(res.result.content[0].text);
    expect(body.chainId).toBe(8453);
    expect(body.verdicts.length).toBeGreaterThan(0);
  });

  // Raw bytes, not a string through `data`: Playwright serialises a string as
  // JSON, so "not json" arrives as the perfectly valid document "not json" and
  // exercises the wrong branch entirely.
  test("unparseable bytes are a parse error, not a crash", async ({ request }) => {
    const res = await request.post("/api/mcp", {
      data: Buffer.from("{oops"), headers: { "content-type": "application/json" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe(-32700);
  });

  // Valid JSON that is not a request is -32600 in the body with a 200, which
  // is what JSON-RPC asks for: the transport succeeded, the message did not.
  test("valid JSON that is not a request is an invalid-request reply", async ({ request }) => {
    const res = await request.post("/api/mcp", {
      data: Buffer.from('"hello"'), headers: { "content-type": "application/json" },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).error.code).toBe(-32600);
  });

  // Somebody else's agent, on an origin we cannot know, calling public data.
  test("is reachable cross-origin", async ({ request }) => {
    const res = await request.fetch("/api/mcp", { method: "OPTIONS" });
    expect(res.headers()["access-control-allow-origin"]).toBe("*");
  });
});
