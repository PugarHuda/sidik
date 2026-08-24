import { pathToFileURL } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import type { Hex } from "@sidik/shared";
import { runSidik, type RunEvent } from "./orchestrator.js";

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

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/run", (c) => {
    const token = c.req.query("token");
    if (!token || !TOKEN_RE.test(token)) {
      return c.json({ error: "token must be a 0x-prefixed 40-hex-char address" }, 400);
    }
    return streamSSE(c, async (stream) => {
      for await (const event of runner(token as Hex)) {
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
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
  console.log(`sidik engine listening on :${port}`);
}
