import { pathToFileURL } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import type { Hex } from "@sidik/shared";
import { runSidik, type RunEvent } from "./orchestrator.js";
import { acquireRunSlot, MAX_CONCURRENT_RUNS, runsInFlight } from "./concurrency.js";
import { cacheSize } from "./cache.js";
import { BASE_FORK_BLOCK } from "./forkBlock.js";
import { log } from "./log.js";
import { forkProxyStats } from "./forkProxy.js";

const TOKEN_RE = /^0x[0-9a-fA-F]{40}$/;

type Runner = (token: Hex) => AsyncGenerator<RunEvent>;

export function createApp(runner: Runner = runSidik) {
  const app = new Hono();

  // Anyone who deploys this is paying for its archive RPC, and an open origin
  // means any page on the internet can spend that quota. Set WEB_ORIGIN to the
  // site that should be allowed; "*" stays the default only because a demo
  // with no configured origin should still work rather than fail silently.
  const origin = process.env.WEB_ORIGIN ?? "*";
  app.use("*", cors({ origin }));

  // Enough to answer "is it up, is it busy, and is it configured" without a
  // second request. archiveRpc reports only whether the variable is set —
  // never the URL, which carries the API key.
  app.get("/health", (c) => c.json({
    ok: true,
    runsInFlight: runsInFlight(),
    maxConcurrentRuns: MAX_CONCURRENT_RUNS,
    forkBlock: BASE_FORK_BLOCK.toString(),
    cache: cacheSize(),
    archiveRpc: process.env.BASE_ARCHIVE_RPC ? "configured" : "missing",
    // Requests anvil made through the fork proxy, and how many the gateway
    // throttled. A rising `throttled` is the difference between an engine
    // that is slow and an engine that is being rate-limited.
    forkProxy: forkProxyStats(),
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get("/run", (c) => {
    const token = c.req.query("token");
    if (!token || !TOKEN_RE.test(token)) {
      return c.json({ error: "token must be a 0x-prefixed 40-hex-char address" }, 400);
    }
    // Refuse rather than degrade. Accepting an unbounded number of runs means
    // every one of them gets rate-limited forks, and a rate-limited fork reads
    // as a finding about the token instead of about the traffic.
    const release = acquireRunSlot();
    if (!release) {
      return c.json({
        error: `engine is busy: ${MAX_CONCURRENT_RUNS} runs already in flight`,
        retryable: true,
      }, 503);
    }

    return streamSSE(c, async (stream) => {
      try {
        for await (const event of runner(token as Hex)) {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        }
      } finally {
        // Also covers the client hanging up mid-run: without this the slot
        // would stay taken and the engine would wedge itself shut.
        release();
      }
    });
  });

  return app;
}

export const app = createApp();

// ponytail: guard so `import`ing this module (tests) never starts a listener —
// only actually running `server.ts` as the entrypoint does.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: app.fetch, port });
  log.info({ event: "server.listening", count: port });
}
