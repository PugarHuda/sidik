import { describe, expect, it } from "vitest";
import { FIXTURES, FIXTURE_BLOCK } from "@sidik/shared";
import { cacheSize, getCached, setCached } from "../src/cache";

const BLOCK = BigInt(FIXTURE_BLOCK);
const anyRecorded = Object.keys(FIXTURES)[0]!;

describe("cache", () => {
  it("serves every recorded run at the block it was produced at", () => {
    expect(getCached(anyRecorded, BLOCK)).toBeDefined();
    expect(cacheSize().seeded).toBe(Object.keys(FIXTURES).length);
  });

  it("misses at a different block rather than serving stale proof", () => {
    // The whole point of keying by block: bumping the pin must invalidate,
    // not quietly answer for the old one.
    expect(getCached(anyRecorded, BLOCK + 1n)).toBeUndefined();
  });

  it("is case-insensitive about the address", () => {
    expect(getCached(anyRecorded.toUpperCase().replace("0X", "0x"), BLOCK)).toBeDefined();
  });

  it("evicts live entries past the ceiling but never a recorded run", () => {
    const before = cacheSize();
    // Comfortably past MAX_LIVE_ENTRIES (500) so eviction has to have run.
    for (let i = 0; i < 600; i++) {
      setCached(`0x${i.toString(16).padStart(40, "0")}`, BLOCK, { i });
    }
    const after = cacheSize();

    expect(after.live).toBeLessThanOrEqual(500);
    expect(after.seeded).toBe(before.seeded);
    // The recorded run is the product; growth control must not touch it.
    expect(getCached(anyRecorded, BLOCK)).toBeDefined();
    // The newest live write survived, the oldest did not.
    expect(getCached(`0x${(599).toString(16).padStart(40, "0")}`, BLOCK)).toBeDefined();
    expect(getCached(`0x${(0).toString(16).padStart(40, "0")}`, BLOCK)).toBeUndefined();
  });
});
