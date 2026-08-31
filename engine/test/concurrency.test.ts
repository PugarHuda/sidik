import { describe, it, expect } from "vitest";
import { acquireRunSlot, MAX_CONCURRENT_RUNS, runsInFlight } from "../src/concurrency";

describe("run slots", () => {
  it("hands out exactly the configured number and then refuses", () => {
    const held = [];
    for (let i = 0; i < MAX_CONCURRENT_RUNS; i++) {
      const r = acquireRunSlot();
      expect(r).toBeDefined();
      held.push(r!);
    }
    expect(runsInFlight()).toBe(MAX_CONCURRENT_RUNS);
    expect(acquireRunSlot()).toBeUndefined();
    held.forEach((r) => r());
    expect(runsInFlight()).toBe(0);
  });

  // A stream that errors and then closes calls release twice. Left ungurded
  // the count drifts negative, which silently raises the cap for good.
  it("ignores a double release rather than letting the count drift", () => {
    const release = acquireRunSlot()!;
    release();
    release();
    expect(runsInFlight()).toBe(0);
    const again = acquireRunSlot();
    expect(again).toBeDefined();
    again!();
  });
});
