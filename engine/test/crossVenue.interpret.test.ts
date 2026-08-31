import { describe, it, expect } from "vitest";
import { interpretCrossVenue, usd } from "../src/probes/crossVenue";
const ctx = {} as any;

const asked = [{ name: "BingX", ticker: "BRETT" }, { name: "Gate", ticker: "BRETT" }];
const quote = (over: Record<string, unknown> = {}) => ({
  venue: "bingx", name: "BingX", ticker: "BRETT",
  onchainUsd: 0.00436, venueUsd: 0.004177, premiumPct: 4.39, ...over,
});

describe("interpretCrossVenue", () => {
  it("PASSes when the pool prices the token like the market", () => {
    const v = interpretCrossVenue(
      { asked, quotes: [quote()], ethSpent: "1 ETH", buyTxHash: "0xb" }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.numbers.bingxPrice).toBe("$0.004177");
    expect(v.numbers.difference).toBe("+4.39%");
    expect(v.txHashes).toContain("0xb");
  });

  it("FAILs when buying through the pool costs far more than the market price", () => {
    const v = interpretCrossVenue(
      { asked, quotes: [quote({ onchainUsd: 0.01, venueUsd: 0.004, premiumPct: 150 })],
        ethSpent: "1 ETH", buyTxHash: "0xb" }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toMatch(/cost \+150% more/i);
    expect(v.rows[0]?.ok).toBe(false);
  });

  // Substituting a nearby hour's price for the one asked about would be a
  // fabricated comparison, so a missing candle has to surface as NA.
  it("is NA when no venue has a price for that hour", () => {
    const v = interpretCrossVenue(
      { asked, quotes: [], unavailable: "DEGEN was not trading on BingX during that hour" }, ctx);
    expect(v.status).toBe("NA");
    expect(v.rows[0]?.proven).toMatch(/not trading/i);
    expect(v.numbers.onchainPrice).toBeUndefined();
    // The reader is told who was asked, so an NA is not mistaken for "nobody
    // bothered to check".
    expect(v.numbers.venuesAsked).toBe("BingX (BRETT) and Gate (BRETT)");
  });

  it("reports every venue it got a price from, not just the one that decided it", () => {
    const v = interpretCrossVenue({
      asked,
      quotes: [
        quote({ venue: "bingx", name: "BingX", venueUsd: 0.004177, premiumPct: 4.39 }),
        quote({ venue: "gate", name: "Gate", venueUsd: 0.004184, premiumPct: 4.21 }),
      ],
      ethSpent: "1 ETH", buyTxHash: "0xb",
    }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.rows).toHaveLength(2);
    expect(v.numbers.bingxPrice).toBe("$0.004177");
    expect(v.numbers.gatePrice).toBe("$0.004184");
    expect(v.title).toMatch(/2 independent venues/);
  });

  // A finding against a token must not rest on whichever book happened to be
  // thinnest that hour. The most favourable venue decides; both are shown.
  it("decides on the venue most favourable to the token, and still shows the other", () => {
    const v = interpretCrossVenue({
      asked,
      quotes: [
        quote({ venue: "bingx", name: "BingX", venueUsd: 0.001, premiumPct: 336 }),
        quote({ venue: "gate", name: "Gate", venueUsd: 0.004177, premiumPct: 4.39 }),
      ],
      ethSpent: "1 ETH", buyTxHash: "0xb",
    }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.numbers.venue).toBe("gate");
    expect(v.rows.some((r) => r.ok === false)).toBe(true);
  });

  // A fixed 2dp renders every memecoin as $0.00, which is not a price.
  it("keeps enough digits for a token that trades in millionths", () => {
    const v = interpretCrossVenue({
      asked: [{ name: "BingX", ticker: "TOSHI" }],
      quotes: [quote({ ticker: "TOSHI", onchainUsd: 0.0001087, venueUsd: 0.0001061, premiumPct: 2.42 })],
      ethSpent: "1 ETH", buyTxHash: "0xb",
    }, ctx);
    expect(v.numbers.onchainPrice).toBe("$0.0001087");
    expect(v.numbers.onchainPrice).not.toBe("$0.00");
  });
});

describe("usd", () => {
  it("renders an empty hour as $0, not ten decimal places of nothing", () => {
    // log10(0) is -Infinity, so the digit count came out Infinity, capped at
    // ten: an hour with no trading was reported as "$0.0000000000".
    expect(usd(0)).toBe("$0");
  });

  it("keeps two decimals once the whole part carries the meaning", () => {
    expect(usd(47.64)).toBe("$47.64");
    expect(usd(1)).toBe("$1.00");
    expect(usd(2843557.63)).toBe("$2843557.63");
  });

  it("keeps significant digits for prices below a dollar", () => {
    // A memecoin at two decimal places is $0.00 for every one of them.
    expect(usd(0.0001061)).toMatch(/^\$0\.0001/);
    expect(usd(0.004177)).toMatch(/^\$0\.004/);
    expect(Number(usd(0.000000123).slice(1))).toBeGreaterThan(0);
  });

  it("does not print Infinity or NaN at a reader", () => {
    expect(usd(Infinity)).toBe("$—");
    expect(usd(-Infinity)).toBe("$—");
    expect(usd(NaN)).toBe("$—");
  });

  it("handles a negative without inverting the digit count", () => {
    // Math.log10 of a negative is NaN, which made the digit count NaN and
    // toFixed fall back to zero decimals.
    expect(usd(-0.5)).toMatch(/^\$-0\.5/);
    expect(usd(-3)).toBe("$-3.00");
  });
});
