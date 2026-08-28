import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { startForkProxy, type ForkProxy } from "../src/forkProxy.js";

/**
 * A stand-in for the gateway that broke every fork: answers the methods a
 * node has, and every other method with HTTP 400 — exactly what Alchemy does
 * with anvil's `anvil_nodeInfo` probe.
 */
const KNOWN: Record<string, unknown> = { eth_chainId: "0x2105", eth_blockNumber: "0x2fdfdc0" };
let upstream: Server;
let upstreamUrl: string;
let seen: string[] = [];

function answer(r: { id?: unknown; method?: string }) {
  if (r.method && r.method in KNOWN) return { jsonrpc: "2.0", id: r.id, result: KNOWN[r.method] };
  return undefined;
}

beforeAll(async () => {
  upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const items = Array.isArray(body) ? body : [body];
    seen.push(...items.map((i) => i.method));
    const unknown = items.find((i) => !answer(i));
    if (unknown) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: unknown.id, error: { code: -32600, message: `Unsupported method: ${unknown.method} on BASE_MAINNET` } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(Array.isArray(body) ? items.map(answer) : answer(body)));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
  const a = upstream.address();
  upstreamUrl = `http://127.0.0.1:${typeof a === "string" ? 0 : a!.port}`;
});
afterAll(() => { upstream.close(); });

async function rpc(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

describe("fork proxy", () => {
  let proxy: ForkProxy;
  beforeAll(async () => { proxy = await startForkProxy(upstreamUrl); });
  afterAll(() => proxy.close());

  // The whole reason this exists. Without it: HTTP 400, and anvil exits
  // with "failed to determine network family from fork endpoint".
  it("answers anvil's nodeInfo probe with a 200 method-not-found, never asking upstream", async () => {
    seen = [];
    const { status, body } = await rpc(proxy.url, { jsonrpc: "2.0", id: 7, method: "anvil_nodeInfo", params: [] });
    expect(status).toBe(200);
    expect(body.id).toBe(7);
    expect(body.error?.code).toBe(-32601);
    expect(seen).toEqual([]);
  });

  it("forwards a real method and hands back what upstream said", async () => {
    const { status, body } = await rpc(proxy.url, { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
    expect(status).toBe(200);
    expect(body.result).toBe("0x2105");
  });

  // Passing upstream's status through is what keeps anvil's own 429
  // handling working; the proxy must not launder a failure into a 200.
  it("passes an upstream error status through untouched for methods it does not own", async () => {
    const { status, body } = await rpc(proxy.url, { jsonrpc: "2.0", id: 2, method: "eth_notAThing", params: [] });
    expect(status).toBe(400);
    expect(body.error?.message).toMatch(/Unsupported method/);
  });

  it("splits a mixed batch, answers its own part, and merges the answers back in order", async () => {
    const { status, body } = await rpc(proxy.url, [
      { jsonrpc: "2.0", id: "a", method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: "b", method: "anvil_nodeInfo", params: [] },
      { jsonrpc: "2.0", id: "c", method: "eth_blockNumber", params: [] },
    ]);
    expect(status).toBe(200);
    expect(body.map((b: { id: string }) => b.id)).toEqual(["a", "b", "c"]);
    expect(body[0].result).toBe("0x2105");
    expect(body[1].error?.code).toBe(-32601);
    expect(body[2].result).toBe("0x2fdfdc0");
  });

  // A free-tier gateway answers part of every fork burst with 429, and anvil's
  // own retries are too brief to outlast it. The proxy waits and asks again;
  // the caller sees the eventual answer, not the throttle.
  it("outlasts a 429 burst instead of handing it to anvil", async () => {
    let calls = 0;
    const flaky = createServer((_req, res) => {
      calls++;
      if (calls <= 2) { res.writeHead(429, { "retry-after": "0" }); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 9, result: "0x2105" }));
    });
    await new Promise<void>((r) => flaky.listen(0, "127.0.0.1", () => r()));
    const a = flaky.address();
    const via = await startForkProxy(`http://127.0.0.1:${typeof a === "string" ? 0 : a!.port}`);
    try {
      const { status, body } = await rpc(via.url, { jsonrpc: "2.0", id: 9, method: "eth_chainId", params: [] });
      expect(status).toBe(200);
      expect(body.result).toBe("0x2105");
      expect(calls).toBe(3);
    } finally { via.close(); flaky.close(); }
  });

  it("reports an unreachable upstream as a JSON-RPC error, not a hang", async () => {
    const dead = await startForkProxy("http://127.0.0.1:1");
    try {
      const { status, body } = await rpc(dead.url, { jsonrpc: "2.0", id: 3, method: "eth_chainId", params: [] });
      expect(status).toBe(502);
      expect(body.error?.message).toMatch(/unreachable/);
    } finally { dead.close(); }
  });
});
