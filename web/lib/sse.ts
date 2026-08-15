import type { PreScan, Verdict } from "@sidik/shared";

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
  | { type: "error"; message: string };

/**
 * Opens `url` and yields parsed SSE frames as typed RunEvents. Uses
 * fetch + ReadableStream (not EventSource) because the request goes through
 * our own Next.js proxy route, and EventSource can't send through it with
 * custom handling / non-GET-only semantics as cleanly as fetch can.
 */
export async function* streamRunEvents(url: string, signal?: AbortSignal): AsyncGenerator<RunEvent> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) {
    throw new Error(`stream failed: ${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLines = frame.split("\n").filter((l) => l.startsWith("data:"));
      if (dataLines.length === 0) continue; // comment/keep-alive frame
      const json = dataLines.map((l) => l.slice(5).trimStart()).join("\n");
      try {
        yield JSON.parse(json) as RunEvent;
      } catch {
        // ponytail: skip a malformed frame rather than kill the whole stream
      }
    }
  }
}
