import { describe, it, expect } from "vitest";
import { createApp } from "../src/server.js";
import type { RunEvent } from "../src/orchestrator.js";
import type { Hex } from "@sidik/shared";

const VALID_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex; // 40 hex chars

async function* fakeRunner(_token: Hex): AsyncGenerator<RunEvent> {
  yield { type: "prescan", scan: { token: _token, isErc20: true, symbol: "TST", decimals: 18, hasPool: true, topHolders: [] } };
  yield { type: "done" };
}

describe("server", () => {
  it("GET /health -> 200 {ok:true}", async () => {
    const app = createApp(fakeRunner);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
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
