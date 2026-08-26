/**
 * Run an async mapper over a list with a ceiling on how many run at once.
 *
 * `Promise.all(list.map(...))` starts everything in the same tick. That was
 * how the holder sample read balances: measured against BRETT at the pinned
 * block, 9,000 blocks of Transfer logs name 388 unique addresses, so one
 * pre-scan opened 388 simultaneous eth_calls against a single anvil. Anvil
 * serves them, but each one is a fresh archive read upstream, and the same
 * burst is what makes a free-tier RPC start answering 429 — which then
 * surfaces as a probe reporting NA about the token.
 *
 * Results come back as a settled list in input order: one address that
 * reverts costs its own entry and nothing else. Promise.all rejects the whole
 * batch on the first failure, which meant a single unreadable holder threw
 * away the entire sample.
 *
 * Not p-limit (npm, ~50M downloads/week, actively maintained). It is the
 * right library for a general case and would be the choice for anything
 * needing queue introspection or cancellation. This is one bounded map over
 * one list, and a dependency that ships an AbortController-based queue to
 * replace fifteen lines is not worth the supply chain.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i] as T, i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };

  // Never more workers than there is work, and never fewer than one.
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
