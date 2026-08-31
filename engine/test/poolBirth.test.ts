import { describe, it, expect } from "vitest";
import { bisectBirth } from "../src/probes/lpRug";

/** A chain where `pool` was created at `birth`, counting how often it was asked. */
const chain = (birth: bigint) => {
  let calls = 0;
  const hasCodeAt = async (block: bigint) => { calls++; return block >= birth; };
  return { hasCodeAt, reads: () => calls };
};

describe("bisectBirth", () => {
  // Off by one either way is a search over the wrong 9,000 blocks, reported to
  // a reader as "this pool has no position" — a finding about the token made
  // out of a mistake about arithmetic. Both boundaries are pinned here.
  it("finds the exact block the pool got its code", async () => {
    for (const birth of [1n, 2n, 7_565_119n, 48_326_428n, 50_199_999n]) {
      const c = chain(birth);
      expect(await bisectBirth(c.hasCodeAt, 50_200_000n)).toBe(birth);
    }
  });

  it("returns 0 for something that existed at genesis", async () => {
    expect(await bisectBirth(chain(0n).hasCodeAt, 50_200_000n)).toBe(0n);
  });

  // The whole reason this is affordable at probe time. 50.2M blocks is 26
  // reads, and the measured cost against mainnet.base.org is ~9s — the
  // twelve-minute figure recorded on 2026-08-31 was the fork proxy, not this.
  it("costs a logarithmic number of reads, not a linear one", async () => {
    const c = chain(48_326_428n);
    await bisectBirth(c.hasCodeAt, 50_200_000n);
    expect(c.reads()).toBe(26);
  });

  // Never bisected below the answer: a pool with code at every block it was
  // asked about has to come back as the head, which the caller reads as "no
  // birth found" rather than as block 0.
  it("returns the head when the pool has code nowhere below it", async () => {
    expect(await bisectBirth(async () => false, 50_200_000n)).toBe(50_200_000n);
  });
});
