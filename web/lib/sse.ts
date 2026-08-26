import type { PreScan, Verdict } from "@sidik/shared";
import { EventSourceParserStream } from "eventsource-parser/stream";

// Mirrors engine/src/orchestrator.ts's RunEvent union. Not imported directly —
// the engine package pulls in server-only deps (hono, anvil tooling) we don't
// want in the web bundle, so this is the client-side source of truth's twin.
// Keep in sync by hand if the engine union changes.
export type RunEvent =
  | { type: "prescan"; scan: PreScan }
  | { type: "plan"; ids: string[] }
  | { type: "probe:start"; id: string }
  | { type: "verdict"; verdict: Verdict }
  | { type: "narration"; text: string }
  | { type: "done" }
  | { type: "error"; message: string }
  // Client-only marker the proxy route prepends when it replays a recorded
  // run instead of reaching a live engine. The engine itself never sends it.
  // The data that follows is genuine fork output, just not produced just now,
  // which is why the banner says "recorded" and not "simulated".
  | { type: "replay"; block: string };

/**
 * Opens `url` and yields parsed SSE frames as typed RunEvents.
 *
 * Uses fetch + ReadableStream rather than EventSource because the request goes
 * through our own Next.js proxy route, and EventSource cannot carry the
 * abort semantics this needs.
 *
 * Framing is handed to eventsource-parser rather than done here. The previous
 * hand-rolled version split the buffer on "\n\n" and nothing else, so a
 * stream delivered with CRLF line endings — legal per the SSE spec, and what
 * some proxies emit — would never yield a single event and the page would sit
 * there waiting forever with no error to show for it. That library also
 * handles the BOM, comment lines and multi-line data fields properly.
 */
export async function* streamRunEvents(url: string, signal?: AbortSignal): AsyncGenerator<RunEvent> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) {
    throw new Error(`stream failed: ${res.status} ${res.statusText}`);
  }

  const events = res.body
    .pipeThrough(new TextDecoderStream())
    // A malformed frame should cost that frame, not the rest of the run:
    // leaving onError unset means the parser skips and keeps going.
    .pipeThrough(new EventSourceParserStream());

  const reader = events.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.data) continue; // keep-alive or a frame carrying only metadata
      try {
        yield JSON.parse(value.data) as RunEvent;
      } catch {
        // Skip a frame whose payload is not the JSON we expect rather than
        // killing the whole stream over it.
      }
    }
  } finally {
    reader.releaseLock();
  }
}
