import { createServer, type Server } from "node:http";

/**
 * A local JSON-RPC endpoint that stands between anvil and the archive RPC.
 *
 * Before forking, anvil asks the endpoint `anvil_nodeInfo` to find out whether
 * it is talking to another anvil. A plain node answers that with a JSON-RPC
 * "method not found" error over HTTP 200, which anvil reads as "not an anvil,
 * carry on". Alchemy's gateway answers every unknown method with **HTTP 400**
 * instead — and anvil 1.7.1 treats a 400 as the transport failing, prints
 * "failed to determine network family from fork endpoint", and exits before
 * a single block is fetched. Every fork in the engine died that way on
 * 2026-08-28, on a key that had served the whole catalogue the day before.
 * `--network ethereum` does not skip the probe.
 *
 * So the engine forks through this instead. Anything `anvil_*` or
 * `hardhat_*` is answered here, as the JSON-RPC error a plain node would
 * give; everything else is forwarded byte for byte, status and all — except
 * that a 429 is waited out here first (see forwardWithBackoff), because
 * anvil's own retries are too brief for a free-tier gateway. Loopback only,
 * one hop, no dependency.
 */

/** Methods a plain node does not have, answered here rather than upstream. */
const LOCAL_ONLY = /^(anvil|hardhat)_/;

interface RpcRequest { jsonrpc?: string; id?: unknown; method?: string; params?: unknown }

function methodNotFound(id: unknown, method: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message: `Method not found: ${method}` } };
}

/**
 * How long to keep trying a throttled upstream before handing anvil the 429.
 *
 * A fork start is a burst of archive reads, and a free-tier gateway answers
 * part of the burst with 429. anvil retries those itself, but briefly — on
 * 2026-08-28, after a day of re-recording, four integration tests died on
 * "Max retries exceeded HTTP error 429" before a single fork stood up. This
 * is the one place that sees every request, so it is where waiting belongs:
 * up to six tries, backing off from half a second, honouring Retry-After
 * when the gateway sends one. Anything else still passes straight through.
 */
const THROTTLE_ATTEMPTS = 6;
const THROTTLE_BASE_MS = 500;
const THROTTLE_MAX_MS = 8_000;

async function forwardWithBackoff(upstream: string, body: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const up = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // Generous: the slow archive reads are the ones worth waiting for.
      signal: AbortSignal.timeout(60_000),
    });
    if (up.status !== 429) return up;
    stats.throttled++;
    // Out of attempts: hand the 429 back with its body intact. The loop used
    // to drain it and sleep first anyway, so the caller re-read a spent
    // Response, threw, and booked the event as `unreachable` — the opposite of
    // what happened, on the one counter that exists to tell throttling from an
    // outage — after a wait of up to eight seconds that nothing came after.
    if (attempt >= THROTTLE_ATTEMPTS - 1) return up;
    const retryAfter = Number(up.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, THROTTLE_MAX_MS)
      : Math.min(THROTTLE_BASE_MS * 2 ** attempt, THROTTLE_MAX_MS);
    await up.text().catch(() => ""); // release the socket before sleeping
    await new Promise((r) => setTimeout(r, wait));
  }
}

/**
 * What the proxy has seen since the process started. Read by /health: on a
 * deployed engine these are the only way to tell "forks are slow because the
 * gateway is throttling" from "forks are slow".
 */
const stats = { requests: 0, throttled: 0, upstreamErrors: 0, unreachable: 0 };
export function forkProxyStats(): Readonly<typeof stats> { return { ...stats }; }

export interface ForkProxy {
  /** The URL to hand anvil as --fork-url. */
  url: string;
  close(): void;
}

export function startForkProxy(upstream: string): Promise<ForkProxy> {
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");

    let parsed: RpcRequest | RpcRequest[] | undefined;
    try { parsed = JSON.parse(raw); } catch { /* not JSON — forward untouched */ }

    // A single local-only call is the case that matters (the nodeInfo probe).
    // A batch is split: local-only items answered here, the rest forwarded as
    // one batch, and the answers put back in the order they were asked.
    const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const local = items.map((r) => (r?.method && LOCAL_ONLY.test(r.method)) ? methodNotFound(r.id, r.method) : undefined);
    const toForward = items.filter((_, i) => !local[i]);

    if (items.length && toForward.length === 0) {
      const body = Array.isArray(parsed) ? local : local[0];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }

    stats.requests++;
    let status = 502;
    let body = JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "fork proxy: upstream unreachable" } });
    let contentType = "application/json";
    try {
      const forwardBody = items.length && local.some(Boolean) ? JSON.stringify(toForward) : raw;
      const up = await forwardWithBackoff(upstream, forwardBody);
      status = up.status;
      if (!up.ok) stats.upstreamErrors++;
      contentType = up.headers.get("content-type") ?? contentType;
      body = await up.text();

      if (items.length && local.some(Boolean) && up.ok) {
        // Re-merge a split batch.
        let answers: unknown[] = [];
        try { answers = JSON.parse(body); } catch { /* upstream did not return JSON; pass it through */ }
        if (Array.isArray(answers)) {
          const byId = new Map(answers.map((a) => [String((a as { id?: unknown })?.id), a]));
          const merged = items.map((r, i) => local[i] ?? byId.get(String(r?.id)) ?? methodNotFound(r?.id, String(r?.method)));
          body = JSON.stringify(merged);
        }
      }
    } catch {
      stats.unreachable++; // status/body already describe an unreachable upstream
    }
    res.writeHead(status, { "content-type": contentType });
    res.end(body);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // Port 0: the OS picks a free one, which also cannot collide with anvil's.
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") { reject(new Error("fork proxy did not get a port")); return; }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => { server.close(); },
      });
    });
  });
}
