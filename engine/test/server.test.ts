import { describe, it, expect } from "vitest";
import { createApp } from "../src/server.js";
import type { RunEvent } from "../src/orchestrator.js";
import type { Hex } from "@sidik/shared";
import { acquireRunSlot, MAX_CONCURRENT_RUNS, runsInFlight } from "../src/concurrency.js";

const VALID_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex; // 40 hex chars

async function* fakeRunner(_token: Hex): AsyncGenerator<RunEvent> {
  yield { type: "prescan", scan: { token: _token, isErc20: true, symbol: "TST", decimals: 18, hasPool: true, topHolders: [] } };
  yield { type: "done" };
}

describe("server", () => {
  it("GET /health reports liveness and how loaded the engine is", async () => {
    const app = createApp(fakeRunner);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // A host that can only see "ok" cannot tell a healthy engine from one
    // that is refusing every caller because it is saturated.
    expect(body.maxConcurrentRuns).toBeGreaterThan(0);
    expect(body.runsInFlight).toBe(0);
    // The fork proxy's counters: a rising `throttled` is what tells a slow
    // engine from a rate-limited one, and it has to be readable remotely.
    for (const k of ["requests", "throttled", "upstreamErrors", "unreachable"]) {
      expect(typeof body.forkProxy[k], k).toBe("number");
    }
    // Which block its answers describe, and how many it can already serve
    // without touching the network — both needed to tell a working engine
    // from one that started but has nothing behind it.
    expect(body.forkBlock).toMatch(/^\d+$/);
    expect(body.cache.seeded).toBeGreaterThan(0);
    expect(typeof body.uptimeSeconds).toBe("number");
    // Presence only. The archive URL carries an API key and must never be
    // echoed by an endpoint anyone can call.
    expect(["configured", "missing"]).toContain(body.archiveRpc);
    expect(JSON.stringify(body)).not.toMatch(/https?:\/\//);
  });

  // Accepting unbounded runs means every one of them gets rate-limited forks,
  // and a rate-limited fork reads as a finding about the token.
  it("refuses a run once the in-flight cap is reached, and frees the slot after", async () => {
    const app = createApp(fakeRunner);
    const held: (() => void)[] = [];
    for (let i = 0; i < MAX_CONCURRENT_RUNS; i++) held.push(acquireRunSlot()!);

    const refused = await app.request(`/run?token=${VALID_TOKEN}`);
    expect(refused.status).toBe(503);
    expect((await refused.json()).retryable).toBe(true);

    held.forEach((r) => r());
    const accepted = await app.request(`/run?token=${VALID_TOKEN}`);
    expect(accepted.status).toBe(200);
    await accepted.text();
    expect(runsInFlight()).toBe(0);
  });

  it("GET /run with no token -> 400, no stream", async () => {
    const app = createApp(fakeRunner);
    const res = await app.request("/run");
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).not.toMatch(/event-stream/);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("GET /run with a malformed token -> 400, no stream", async () => {
    const app = createApp(fakeRunner);
    const res = await app.request("/run?token=not-an-address");
    expect(res.status).toBe(400);
  });

  it("GET /run?token=0x<valid> streams injected runner's events as SSE", async () => {
    const app = createApp(fakeRunner);
    const res = await app.request(`/run?token=${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const body = await res.text();
    expect(body).toContain("event: prescan\n");
    expect(body).toContain("event: done\n");
    // frame ends with a blank line (SSE framing)
    expect(body).toMatch(/event: prescan\ndata: .*\n\n/);
    expect(body).toMatch(/event: done\ndata: .*\n\n/);
  });
});
