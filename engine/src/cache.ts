import { FIXTURES, FIXTURE_BLOCK } from "@sidik/shared";

// ponytail: in-memory cache; swap for a KV if the demo must survive restarts.
const store = new Map<string, unknown>();

function key(token: string, block: bigint): string {
  return `${token.toLowerCase()}:${block}`;
}

export function getCached<T = unknown>(token: string, block: bigint): T | undefined {
  return store.get(key(token, block)) as T | undefined;
}

export function setCached<T = unknown>(token: string, block: bigint, value: T): void {
  store.set(key(token, block), value);
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
  for (const [token, run] of Object.entries(FIXTURES)) setCached(token, block, run);
  return Object.keys(FIXTURES).length;
})();
