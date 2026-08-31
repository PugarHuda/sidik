import { describe, expect, it } from "vitest";
import { mapLimit } from "../src/pool";

describe("mapLimit", () => {
  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const items = Array.from({ length: 50 }, (_, i) => i);

    await mapLimit(items, 8, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return n;
    });

    expect(peak).toBeLessThanOrEqual(8);
    // Guards the other direction too: a limit that silently serialised would
    // pass the check above while making a 388-address sample take 388 round
    // trips end to end.
    expect(peak).toBeGreaterThan(1);
  });

  it("keeps results in input order regardless of completion order", async () => {
    const out = await mapLimit([30, 1, 20, 2], 4, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([30, 1, 20, 2]);
  });

  it("lets one failure cost only its own entry", async () => {
    // The case this exists for: one token reverting balanceOf used to reject
    // the Promise.all and throw away every other holder's balance with it.
    const out = await mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("reverted");
      return n * 10;
    });

    expect(out.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(out.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))).toEqual([10, 30]);
  });

  it("handles an empty list without hanging or spawning workers", async () => {
    expect(await mapLimit([], 8, async () => 1)).toEqual([]);
  });

  it("handles a single-element list", async () => {
    const out = await mapLimit([7], 8, async (n) => n);
    expect(out).toEqual([{ status: "fulfilled", value: 7 }]);
  });

  it("still makes progress when the limit is below one", async () => {
    // A misconfigured ceiling should degrade to serial, never to zero workers
    // and a promise that never settles.
    const out = await mapLimit([1, 2], 0, async (n) => n);
    expect(out.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([1, 2]);
  });
});
