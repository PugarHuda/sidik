import { describe, it, expect } from "vitest";
import { interpretCrossVenue, usd } from "../src/probes/crossVenue.js";
const ctx = {} as any;

describe("interpretCrossVenue", () => {
  it("PASSes when the pool prices the token like the market", () => {
    const v = interpretCrossVenue(
      { ticker: "BRETT", onchainUsd: 0.00436, venueUsd: 0.004177, premiumPct: 4.39,
        ethSpent: "1 ETH", buyTxHash: "0xb" }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.numbers.bingxPrice).toBe("$0.004177");
    expect(v.numbers.difference).toBe("+4.39%");
    expect(v.txHashes).toContain("0xb");
  });

  it("FAILs when buying through the pool costs far more than the market price", () => {
    const v = interpretCrossVenue(
      { ticker: "BRETT", onchainUsd: 0.01, venueUsd: 0.004, premiumPct: 150,
        ethSpent: "1 ETH", buyTxHash: "0xb" }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toMatch(/cost \+150% more/i);
  });

  // Substituting a nearby hour's price for the one asked about would be a
  // fabricated comparison, so a missing candle has to surface as NA.
  it("is NA when the venue has no price for that hour", () => {
    const v = interpretCrossVenue(
      { ticker: "DEGEN", unavailable: "DEGEN was not trading on BingX during that hour" }, ctx);
    expect(v.status).toBe("NA");
    expect(v.rows[0]?.proven).toMatch(/not trading/i);
    expect(v.numbers.onchainPrice).toBeUndefined();
  });

  // A fixed 2dp renders every memecoin as $0.00, which is not a price.
  it("keeps enough digits for a token that trades in millionths", () => {
    const v = interpretCrossVenue(
      { ticker: "TOSHI", onchainUsd: 0.0001087, venueUsd: 0.0001061, premiumPct: 2.42,
        ethSpent: "1 ETH", buyTxHash: "0xb" }, ctx);
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
