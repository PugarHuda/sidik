import { describe, it, expect } from "vitest";
import { candleAt, midPrice } from "../src/bingx.js";

// Hits BingX's public endpoint for real. Gated on the archive RPC only
// because it belongs with the other suites that reach the network.
const RUN = !!process.env.BASE_ARCHIVE_RPC;
// The timestamp of Base block 50,200,000 — the block every recorded run is
// pinned to. Both sides of a cross-venue comparison must describe this moment.
const FORK_BLOCK_UNIX = 1787185763;

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
});
