import { describe, it, expect } from "vitest";
import { sincePin } from "../src/head";
import { BASE_FORK_BLOCK } from "../src/forkBlock";

describe("sincePin", () => {
  // Base mines every two seconds exactly, measured against the chain on
  // 2026-08-31. The conversion is arithmetic, so it is worth pinning: a
  // head-block run's whole claim is that it describes a different moment
  // from the catalogue, and this is the number that says how different.
  it("converts a block gap to days at Base's two-second cadence", () => {
    expect(sincePin(BASE_FORK_BLOCK + 43_200n).days).toBeCloseTo(1, 6);
    expect(sincePin(BASE_FORK_BLOCK + 432_000n).days).toBeCloseTo(10, 6);
  });

  it("reports no gap at the pin itself", () => {
    expect(sincePin(BASE_FORK_BLOCK)).toEqual({ blocks: 0n, days: 0 });
  });

  // A block before the pin is not a negative distance into the future; the
  // catalogue is simply ahead of it, and "-3 days" on a page would be nonsense.
  it("never reports a negative gap for a block behind the pin", () => {
    expect(sincePin(BASE_FORK_BLOCK - 1000n)).toEqual({ blocks: 0n, days: 0 });
  });
});

describe("the forked event", () => {
  // The block a run happened at used to be assumed by the page, which was
  // harmless while every run used the pin and became a false statement the
  // moment one did not. The engine states it instead.
  it("names the block and whether it is the head", async () => {
    const { runSidik } = await import("../src/orchestrator");
    const { BASE_FORK_BLOCK: pin } = await import("../src/forkBlock");
    const fake = {
      openFork: async () => ({ fork: {} as never, close: async () => {} }),
      prescan: async () => ({ token: "0x0" as never, isErc20: false, symbol: "", decimals: 18, hasPool: false, topHolders: [] }),
      planProbes: async () => [],
      narrate: async () => "",
    } as never;

    const atPin = [];
    for await (const e of runSidik("0x0" as never, { ...(fake as object), block: pin } as never)) atPin.push(e);
    expect(atPin[0]).toEqual({ type: "forked", block: pin.toString(), head: false });

    const later = pin + 500_000n;
    const atHead = [];
    for await (const e of runSidik("0x0" as never, { ...(fake as object), block: later } as never)) atHead.push(e);
    expect(atHead[0]).toEqual({ type: "forked", block: later.toString(), head: true });
  });
});
