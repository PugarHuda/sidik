import { describe, it, expect } from "vitest";
import { candleAt, isTraded, MIN_QUOTE_VOLUME_USD, midPrice } from "../src/bingx.js";

// Hits BingX's public endpoint for real. Gated on the archive RPC only
// because it belongs with the other suites that reach the network.
const RUN = !!process.env.BASE_ARCHIVE_RPC;
// The timestamp of Base block 50,200,000 — the block every recorded run is
// pinned to. Both sides of a cross-venue comparison must describe this moment.
//
// This was 1787185763 for a while, which is a full hour early, so every
// figure reasoned from it described the 00:00 candle while the probe was
// reading the 01:00 one. fork.integration.test.ts now asserts this constant
// against the block itself so it cannot drift again unnoticed.
const FORK_BLOCK_UNIX = 1787189347;

(RUN ? describe : describe.skip)("BingX market data (integration)", () => {
  it("returns the candle whose window contains the forked block", async () => {
    const c = await candleAt("ETH-USDT", FORK_BLOCK_UNIX);
    expect(c).toBeDefined();
    const ms = FORK_BLOCK_UNIX * 1000;
    expect(c!.openTimeMs).toBeLessThanOrEqual(ms);
    expect(c!.closeTimeMs).toBeGreaterThanOrEqual(ms);
    expect(midPrice(c!)).toBeGreaterThan(0);
  }, 60_000);

  it("prices a Base token that genuinely trades there", async () => {
    const c = await candleAt("BRETT-USDT", FORK_BLOCK_UNIX);
    expect(c).toBeDefined();
    expect(midPrice(c!)).toBeGreaterThan(0);
  }, 60_000);

  // Never the nearest candle: handing back a different hour's price for the
  // hour that was asked about would be an invented comparison.
  it("returns nothing for a symbol that does not exist rather than a substitute", async () => {
    expect(await candleAt("NOTATOKEN123-USDT", FORK_BLOCK_UNIX)).toBeUndefined();
  }, 60_000);

  it("carries the traded volume, not just the prices", async () => {
    // Half the candle payload was being discarded. Without volume there is no
    // way to tell a busy hour from a still one, and both were quoted with the
    // same confidence.
    const c = await candleAt("ETH-USDT", FORK_BLOCK_UNIX);
    expect(c!.volume).toBeGreaterThan(0);
    expect(c!.quoteVolume).toBeGreaterThan(0);
  }, 60_000);

  it("accepts an hour that actually traded", async () => {
    // Measured in the hour containing this block: USDC $2,843,558,
    // ETH $7,501,536, BRETT $1,763 — all above the floor.
    for (const symbol of ["ETH-USDT", "USDC-USDT", "BRETT-USDT"]) {
      const c = await candleAt(symbol, FORK_BLOCK_UNIX);
      expect(c, symbol).toBeDefined();
      expect(isTraded(c!), `${symbol} traded ${c!.quoteVolume}`).toBe(true);
    }
  }, 90_000);

  it("refuses an hour in which almost nothing changed hands", async () => {
    // VIRTUAL traded nothing whatsoever in this hour — its candle repeats the
    // previous hour's close — and the probe still returned PASS: "the pool
    // prices it like the wider market."
    const c = await candleAt("VIRTUAL-USDT", FORK_BLOCK_UNIX);
    expect(c).toBeDefined();
    expect(c!.quoteVolume).toBeLessThan(MIN_QUOTE_VOLUME_USD);
    expect(isTraded(c!)).toBe(false);
  }, 60_000);
});
