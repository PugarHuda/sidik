import type { NextRequest } from "next/server";
import type { Hex } from "@sidik/shared";
import type { RunEvent } from "@/lib/sse";
import { FIXTURES, FIXTURE_BLOCK, recordedRun, safeNarration } from "@sidik/shared";

export const runtime = "nodejs";
// A live run is minutes long by nature. Vercel's Fluid default is fine on
// Hobby too, but the number that this route depends on should be written
// next to it rather than assumed.
export const maxDuration = 300;

const encoder = new TextEncoder();
const sseFrame = (e: RunEvent) => encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);

// Same shape the engine enforces. Validating here too means garbage never
// reaches it, and — more to the point — never gets answered as though it were
// an address that simply is not covered yet.
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return new Response("token query param is required", { status: 400 });
  if (!ADDRESS_RE.test(token)) {
    // An error event rather than a 400 body: the client is reading an SSE
    // stream, and handing it JSON it cannot parse breaks the page instead of
    // telling anyone what went wrong. With an engine configured this also
    // stops malformed input being proxied upstream.
    return new Response(
      sseFrame({ type: "error", message: `"${token.slice(0, 40)}" is not a Base address — expected 0x followed by 40 hex characters.` }),
      { headers: sseHeaders },
    );
  }

  const engineUrl = process.env.ENGINE_URL;
  // ?replay=1 is a dev convenience only — a configured ENGINE_URL in
  // production must never be short-circuited by a query param.
  const forceReplay = req.nextUrl.searchParams.get("replay") === "1" && process.env.NODE_ENV !== "production";

  if (!engineUrl || forceReplay) {
    // ?instant=1 drops the presentation pacing to zero. The trace is paced so
    // it reads as a sequence, which costs about six seconds — fine for
    // somebody reading one run, wrong for somebody opening their twentieth,
    // and wrong for anything scripted. It changes only the delays: the same
    // events arrive in the same order, carrying the same recorded figures.
    const instant = req.nextUrl.searchParams.get("instant") === "1";
    return new Response(replayStream(token as Hex, instant), { headers: sseHeaders });
  }

  return proxyToEngine(engineUrl, token, req.signal);
}

// A live run is slow by nature — but not unbounded. Node's fetch has no
// default timeout at all: an engine that accepts the connection and then
// stops talking would hold this route open until the platform kills it, and
// the page would sit on a spinner the whole time with nothing to show.
//
// Two different clocks. CONNECT bounds the wait for headers. IDLE bounds the
// silence between frames once they flow: a total timeout of 180s cut healthy
// V3 runs off mid-stream (one sell receipt alone can take longer under a
// throttled gateway) and the page was left on SCANNING with no error frame.
const ENGINE_CONNECT_MS = 60_000;
const ENGINE_IDLE_MS = 90_000;

async function proxyToEngine(engineUrl: string, token: string, clientSignal: AbortSignal): Promise<Response> {
  // Either the reader going away or the engine going quiet ends this.
  const signal = AbortSignal.any([clientSignal, AbortSignal.timeout(ENGINE_CONNECT_MS)]);

  let upstream: Response;
  try {
    upstream = await fetch(`${engineUrl}/run?token=${encodeURIComponent(token)}`, { signal });
  } catch (e) {
    // The client is reading an event stream. Throwing here hands it a 500 HTML
    // error page under a text/event-stream content type, which the parser
    // cannot read — the page would wait forever instead of showing the fault.
    if (clientSignal.aborted) return new Response(null, { status: 499 });
    const why = e instanceof Error && e.name === "TimeoutError"
      ? `The engine did not respond within ${ENGINE_CONNECT_MS / 1000}s.`
      : "The engine could not be reached.";
    return new Response(sseFrame({ type: "error", message: `${why} No verdict was produced, so nothing here is a finding about this token.` }), { headers: sseHeaders });
  }

  // A non-200 engine response is JSON, not SSE — the engine answers 503 with a
  // JSON body when it is already running its maximum number of forks. Piping
  // that through under an event-stream content type yields a stream the parser
  // reads as zero events, so the page hangs on a busy engine rather than
  // saying it is busy.
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    let message = `The engine refused the run (HTTP ${upstream.status}).`;
    try {
      const parsed = JSON.parse(detail) as { error?: unknown; retryable?: unknown };
      if (typeof parsed.error === "string") {
        message = parsed.retryable === true
          ? `${parsed.error}. This is temporary — try again in a moment.`
          : parsed.error;
      }
    } catch { /* not JSON — the status line above is what we can honestly say */ }
    return new Response(sseFrame({ type: "error", message }), { headers: sseHeaders });
  }

  // Passthrough with a silence detector: bytes are forwarded untouched, and a
  // gap longer than ENGINE_IDLE_MS ends the stream with an error frame the
  // page can show, instead of a connection that simply never finishes.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      const arm = () => {
        timer = setTimeout(() => {
          controller.enqueue(sseFrame({
            type: "error",
            message: `The engine went quiet for ${ENGINE_IDLE_MS / 1000}s mid-run. No verdict was produced, so nothing here is a finding about this token.`,
          }));
          controller.terminate();
        }, ENGINE_IDLE_MS);
      };
      arm();
      // Re-armed on every chunk by transform() below.
      (controller as unknown as { arm: () => void }).arm = arm;
    },
    transform(chunk, controller) {
      clearTimeout(timer);
      controller.enqueue(chunk);
      (controller as unknown as { arm: () => void }).arm();
    },
    flush() { clearTimeout(timer); },
  });
  return new Response(upstream.body.pipeThrough(idle), { status: 200, headers: sseHeaders });
}

const sseHeaders = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

// ---- offline replay ----------------------------------------------------
//
// With no engine configured, serve the frozen runs in @sidik/shared — real
// output of real fork runs, generated by `pnpm --filter @sidik/engine
// fixtures`. This used to be a hand-written script of invented verdicts,
// which drifted from what the engine actually proves twice over. Replaying
// recorded truth cannot drift.
//
// An address with no frozen run gets an honest error. Answering for an
// arbitrary token with no engine behind it would be making something up.

// Paced so the trace reads as a sequence of steps rather than appearing all
// at once. The delays are presentation, and nothing but presentation — every
// event below is verbatim from the recorded run.
const STEP_MS = 260;
const PROBE_MS = 620;

function replayStream(token: Hex, instant = false): ReadableStream<Uint8Array> {
  const run = recordedRun(token);
  // The only thing `instant` touches. Every event, figure and hash below is
  // identical either way — this is the pause between them, nothing else.
  const pace = (ms: number) => (instant ? 0 : ms);

  const script: [number, RunEvent][] = run
    ? [
        [0, { type: "replay", block: FIXTURE_BLOCK }],
        [pace(STEP_MS), { type: "prescan", scan: run.scan }],
        [pace(STEP_MS), { type: "plan", ids: run.ids }],
        ...run.verdicts.flatMap((verdict): [number, RunEvent][] => [
          [pace(STEP_MS), { type: "probe:start", id: verdict.probe }],
          [pace(PROBE_MS), { type: "verdict", verdict }],
        ]),
        [pace(STEP_MS), { type: "narration", text: safeNarration(run.narration, run.verdicts) }],
        [pace(STEP_MS / 2), { type: "done" }],
      ]
    // No replay banner here. It announces "recorded run — real fork proof",
    // and on this path there is no recording and no proof — only an error.
    // Emitting it anyway put a claim of evidence at the top of a page whose
    // whole content is that there is none.
    : [
        [pace(STEP_MS), {
          type: "error",
          // Counted, not written down: the catalogue grows every time it is
          // re-recorded, and a hardcoded number would start lying immediately.
          message:
            `No engine is configured, so this address cannot be probed live. ` +
            `${Object.keys(FIXTURES).length} Base addresses have a recorded run — ` +
            `try one of the examples.`,
        }],
      ];

  let i = 0;
  // Cancellation is the normal case, not the exception: every reader who
  // navigates away, reloads, or closes the tab abandons this stream part-way
  // through its paced script.
  //
  // Without this, `pull` was already awaiting its delay when the reader left,
  // and enqueued into a controller that no longer accepts writes when the
  // timer fired. That throws inside the stream, and the rejection has nowhere
  // to go — it took the whole Next server down mid-suite, which then read as
  // ERR_CONNECTION_REFUSED on every test after it.
  let cancelled = false;
  let wake: (() => void) | undefined;

  return new ReadableStream({
    async pull(controller) {
      const step = script[i++];
      if (!step || cancelled) {
        if (!cancelled) controller.close();
        return;
      }
      const [delayMs, event] = step;

      // Interruptible: a cancel during the pause resolves the wait
      // immediately rather than holding a timer open for another half second.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { wake = undefined; resolve(); }, delayMs);
        wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
      });

      if (cancelled) return;
      try {
        controller.enqueue(sseFrame(event));
      } catch {
        // The reader went away between the check above and this write. Their
        // stream, their loss — it must not be this process's problem.
        cancelled = true;
      }
    },
    cancel() {
      cancelled = true;
      wake?.();
    },
  });
}
