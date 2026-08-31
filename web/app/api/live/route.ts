import type { NextRequest } from "next/server";
import type { Hex } from "@sidik/shared";

/**
 * A run executed here and now, against a fork of Base — not a replay.
 *
 * Every other surface on this site serves runs that were recorded on a
 * developer's machine and frozen. That is honest, and it is also the thing a
 * judge cannot poke at: paste an address outside the catalogue and the answer
 * is "no recorded run". This route removes that limit for anyone willing to
 * wait half a minute.
 *
 * It exists because the hosting problem finally had an answer. Forking Base
 * needs an archive RPC and a Foundry binary, and every free container host
 * wanted a card (Fly), a paid tier (Hugging Face Spaces), or a signup that
 * never completed (Koyeb). A serverless function turned out to be enough: the
 * Foundry release downloads into /tmp in under a second, and the engine
 * spawns it exactly as it does on a laptop. See engine/src/anvilBin.ts.
 *
 * `/api/run` is untouched and still replays the catalogue, so the demo cannot
 * be broken by this route being slow, rate-limited or switched off.
 */
export const runtime = "nodejs";
export const maxDuration = 300;
// Never cached: two runs of the same address are two executions, and a cached
// stream would show the second one somebody else's transactions.
export const dynamic = "force-dynamic";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const encoder = new TextEncoder();
const frame = (type: string, data: unknown) =>
  encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

const sseHeaders = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  // Proxies that buffer would hold the whole run and deliver it at the end,
  // which defeats the only reason to stream a trace.
  "x-accel-buffering": "no",
};

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!ADDRESS_RE.test(token)) {
    return new Response(
      frame("error", { type: "error", message: `"${token.slice(0, 40)}" is not a Base address — expected 0x followed by 40 hex characters.` }),
      { headers: sseHeaders },
    );
  }

  // Reported as an error event rather than a 500: the client is reading a
  // stream, and a live run with no archive RPC behind it is a deployment
  // fact, not a finding about the token.
  if (!process.env.BASE_ARCHIVE_RPC) {
    return new Response(
      frame("error", { type: "error", message: "This deployment has no archive RPC configured, so it cannot fork Base. Nothing here is a finding about this token." }),
      { headers: sseHeaders },
    );
  }

  // Imported inside the handler so the engine and its dependencies are never
  // pulled into a request that is not a live run.
  const { runSidik } = await import("@sidik/engine/orchestrator");
  const { acquireRunSlot, MAX_CONCURRENT_RUNS } = await import("@sidik/engine/concurrency");

  const release = acquireRunSlot();
  if (!release) {
    return new Response(
      frame("error", { type: "error", message: `Busy: ${MAX_CONCURRENT_RUNS} live runs are already in flight. The recorded catalogue is unaffected — try again shortly.` }),
      { headers: sseHeaders },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runSidik(token as Hex)) {
          controller.enqueue(frame(event.type, event));
        }
      } catch (e) {
        controller.enqueue(frame("error", {
          type: "error",
          message: `The live run stopped: ${e instanceof Error ? e.message : String(e)}. That is a fault here, not a finding about this token.`,
        }));
      } finally {
        // Also covers the reader hanging up mid-run. Without it the slot stays
        // taken and the next caller is told the engine is busy forever.
        release();
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
}
