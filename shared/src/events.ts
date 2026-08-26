import type { PreScan, Verdict } from "./types";

/**
 * What the engine emits over SSE, one frame per event.
 *
 * This union used to exist twice — once in engine/src/orchestrator.ts and
 * once in web/lib/sse.ts, the second carrying a comment asking whoever
 * changed one to remember the other. They are the two ends of the same wire,
 * so a drift between them is not a type error anywhere: the engine sends a
 * frame the page silently ignores, and nothing reports it. One definition,
 * imported by both ends, makes that drift impossible instead of merely
 * discouraged.
 *
 * It lives in shared rather than engine because the engine package pulls in
 * hono and the anvil tooling, none of which belongs in a browser bundle.
 */
export type EngineEvent =
  | { type: "prescan"; scan: PreScan }
  | { type: "plan"; ids: string[] }
  | { type: "probe:start"; id: string }
  | { type: "verdict"; verdict: Verdict }
  | { type: "narration"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * Prepended by the web proxy when it replays a recorded run instead of
 * reaching a live engine. The engine itself never sends it — the data that
 * follows is genuine fork output, just not produced just now, which is why
 * the banner says "recorded" and not "simulated".
 */
export interface ReplayEvent {
  type: "replay";
  block: string;
}

/** Everything a client can receive: the engine's own events plus the marker. */
export type RunEvent = EngineEvent | ReplayEvent;
