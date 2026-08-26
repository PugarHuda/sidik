import { EventSourceParserStream } from "eventsource-parser/stream";
import type { RunEvent } from "@sidik/shared";

// The union lives in @sidik/shared, defined once for both ends of the wire.
// It used to be copied here by hand under a comment asking whoever edited the
// engine's copy to remember this one.
export type { RunEvent };

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
