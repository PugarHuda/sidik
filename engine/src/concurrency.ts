/**
 * A hard cap on how many runs may be in flight at once.
 *
 * A single /run spawns one anvil per applicable probe — up to five — each
 * replaying a burst of archive reads. Two things break when requests arrive
 * together and nothing stops them:
 *
 *   - the archive RPC answers 429 once forks overlap, and a rate-limited fork
 *     surfaces as a probe reporting NA, which reads as a finding about the
 *     token rather than the traffic;
 *   - process creation itself starts failing once a machine has churned
 *     through enough of them. That is not theoretical here: three catalogue
 *     sweeps died on exactly that, with anvil refusing to start.
 *
 * Refusing the sixth caller plainly is better than accepting everyone and
 * handing them all degraded answers.
 */
export const MAX_CONCURRENT_RUNS = Number(process.env.SIDIK_MAX_CONCURRENT_RUNS ?? "2");

let active = 0;

export function runsInFlight(): number {
  return active;
}

/** Returns a release function, or undefined when the engine is already full. */
export function acquireRunSlot(): (() => void) | undefined {
  if (active >= MAX_CONCURRENT_RUNS) return undefined;
  active++;
  let released = false;
  return () => {
    // Guarded: a stream that errors and then closes would otherwise release
    // twice and let the count drift below zero, quietly raising the cap.
    if (released) return;
    released = true;
    active--;
  };
}
