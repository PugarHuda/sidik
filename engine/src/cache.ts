import { FIXTURES, FIXTURE_BLOCK } from "@sidik/shared";

// ponytail: in-memory cache; swap for a KV if the demo must survive restarts.
const store = new Map<string, unknown>();

/**
 * How many runs may be held beyond the seeded catalogue.
 *
 * Entries are keyed by (token, block) and a pinned block never re-runs, so
 * nothing in here goes stale — invalidation is not the problem. Growth is: a
 * long-lived engine probing arbitrary addresses adds one entry per token and
 * never drops one, and each holds a full scan, every verdict and its
 * narration. The seeded runs are exempt because they are the product; only
 * what a live run adds is bounded, oldest-first.
 */
const MAX_LIVE_ENTRIES = 500;
const seeded = new Set<string>();
const liveOrder: string[] = [];

function key(token: string, block: bigint): string {
  return `${token.toLowerCase()}:${block}`;
}

export function getCached<T = unknown>(token: string, block: bigint): T | undefined {
  return store.get(key(token, block)) as T | undefined;
}

export function setCached<T = unknown>(token: string, block: bigint, value: T): void {
  const k = key(token, block);
  const isNewLive = !seeded.has(k) && !store.has(k);
  store.set(k, value);
  if (!isNewLive) return;

  liveOrder.push(k);
  while (liveOrder.length > MAX_LIVE_ENTRIES) {
    const oldest = liveOrder.shift();
    // Never evict a seeded run: dropping one would turn a recorded proof back
    // into "no engine configured, this address cannot be probed".
    if (oldest !== undefined && !seeded.has(oldest)) store.delete(oldest);
  }
}

/** Entries currently held, for the health endpoint. */
export function cacheSize(): { seeded: number; live: number } {
  return { seeded: seeded.size, live: liveOrder.length };
}

// Pre-run results for the example tokens, produced by `pnpm fixtures` against
// a real fork — genuine output of real runs, not hand-written verdicts. They
// are seeded into the same cache a live run writes to, so serving one takes
// the replay path that is already covered by tests.
//
// The point is judge-time survival: every live run spawns a fork per probe,
// and the archive RPC answers 429 under concurrent forking. Anyone clicking
// an example button gets an answer without touching the network.
//
// Keyed by the fork block they were produced at, so bumping BASE_FORK_BLOCK
// makes them miss rather than serve stale proof about the current pin.
// Not exported: nothing reads the count, and an export that exists only to
// trigger a side effect invites someone to delete it as unused.
void (() => {
  const block = BigInt(FIXTURE_BLOCK);
  for (const [token, run] of Object.entries(FIXTURES)) {
    // Marked before the write so setCached counts these as seeded rather than
    // live, keeping them out of the eviction queue entirely.
    seeded.add(key(token, block));
    setCached(token, block, run);
  }
  return Object.keys(FIXTURES).length;
})();
