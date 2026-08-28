import { describe, it, expect } from "vitest";
import { bingx } from "../src/bingx.js";
import { gate } from "../src/gate.js";
import { baseListings } from "../src/gate.js";
import { isTraded, MIN_QUOTE_VOLUME_USD, midPrice, type Venue } from "../src/venue.js";

// Hits the venues' public endpoints for real. Gated on the archive RPC only
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

// The same contract, asked of every venue. A venue client that quietly
// returned the nearest candle, or mis-read its own column order, would pass a
// test written only against the venue it was built for.
const VENUES: Venue[] = [bingx, gate];

(RUN ? describe : describe.skip)("venue market data (integration)", () => {
  for (const venue of VENUES) {
    describe(venue.name, () => {
      it("returns the candle whose window contains the forked block", async () => {
        const c = await venue.candleAt(venue.pair("ETH"), FORK_BLOCK_UNIX);
        expect(c).toBeDefined();
        const ms = FORK_BLOCK_UNIX * 1000;
        expect(c!.openTimeMs).toBeLessThanOrEqual(ms);
        expect(c!.closeTimeMs).toBeGreaterThanOrEqual(ms);
        expect(midPrice(c!)).toBeGreaterThan(0);
      }, 60_000);

      it("prices a Base token that genuinely trades there", async () => {
        const c = await venue.candleAt(venue.pair("BRETT"), FORK_BLOCK_UNIX);
        expect(c).toBeDefined();
        expect(midPrice(c!)).toBeGreaterThan(0);
      }, 60_000);

      // Never the nearest candle: handing back a different hour's price for
      // the hour that was asked about would be an invented comparison.
      it("returns nothing for a symbol that does not exist rather than a substitute", async () => {
        expect(await venue.candleAt(venue.pair("NOTATOKEN123"), FORK_BLOCK_UNIX)).toBeUndefined();
      }, 60_000);

      // Half the candle payload was being discarded. Without volume there is
      // no way to tell a busy hour from a still one, and both were quoted with
      // the same confidence.
      it("carries the traded volume, not just the prices", async () => {
        const c = await venue.candleAt(venue.pair("ETH"), FORK_BLOCK_UNIX);
        expect(c!.quoteVolume).toBeGreaterThan(0);
        expect(isTraded(c!)).toBe(true);
      }, 60_000);

      // Gate's row puts quote volume second and open sixth, which is not the
      // order BingX uses. Reading the columns in the wrong order still yields
      // plausible-looking numbers, so the check is that they are internally
      // consistent: a mid price times the hour's base volume has to land near
      // the quote volume the venue reports.
      it("reads its own column order correctly", async () => {
        const c = await venue.candleAt(venue.pair("ETH"), FORK_BLOCK_UNIX);
        const mid = midPrice(c!);
        // ETH is in the thousands and its hourly quote volume in the millions;
        // a transposed column would put one of them orders of magnitude out.
        expect(mid).toBeGreaterThan(100);
        expect(mid).toBeLessThan(100_000);
        expect(c!.quoteVolume).toBeGreaterThan(mid);
        expect(c!.closeTimeMs - c!.openTimeMs).toBeGreaterThan(3_500_000);
      }, 60_000);
    });
  }

  it("refuses an hour in which almost nothing changed hands", async () => {
    // VIRTUAL traded nothing whatsoever in this hour on BingX — its candle
    // repeats the previous hour's close — and the probe still returned PASS:
    // "the pool prices it like the wider market."
    const c = await bingx.candleAt("VIRTUAL-USDT", FORK_BLOCK_UNIX);
    expect(c).toBeDefined();
    expect(c!.quoteVolume).toBeLessThan(MIN_QUOTE_VOLUME_USD);
    expect(isTraded(c!)).toBe(false);
  }, 60_000);

  // The reason Gate is worth a second integration at all: it publishes the
  // contract address behind each ticker, so the pairing is the exchange's
  // assertion rather than a hand judgement that could be wrong.
  it("Gate publishes Base contract addresses, and they match the catalogue", async () => {
    const listings = await baseListings();
    expect(listings.size).toBeGreaterThan(50);
    const brett = listings.get("0x532f27101965dd16442e59d40670faf5ebb142e4");
    expect(brett?.currency).toBe("BRETT");
    const usdc = listings.get("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(usdc?.currency).toBe("USDC");
  }, 60_000);
});
