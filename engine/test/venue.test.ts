import { describe, it, expect } from "vitest";
import { covering, isTraded, midPrice, MIN_QUOTE_VOLUME_USD, type Candle } from "../src/venue.js";

const HOUR = 3_600_000;
const at = (openTimeMs: number, over: Partial<Candle> = {}): Candle => ({
  openTimeMs, closeTimeMs: openTimeMs + HOUR - 1,
  open: 1, close: 1, quoteVolume: 10_000, ...over,
});

describe("covering", () => {
  const candles = [at(0), at(HOUR), at(2 * HOUR)];

  it("returns the candle whose window contains the moment", () => {
    expect(covering(candles, HOUR + 60_000)?.openTimeMs).toBe(HOUR);
  });

  // The rule the whole cross-venue comparison rests on: a price from a
  // different hour is a fabricated comparison, not an approximation. Both
  // ends of the window are inclusive, so neither boundary silently falls
  // through to a neighbour.
  it("includes both ends of the window", () => {
    expect(covering(candles, HOUR)?.openTimeMs).toBe(HOUR);
    expect(covering(candles, 2 * HOUR - 1)?.openTimeMs).toBe(HOUR);
  });

  it("returns nothing rather than the nearest candle when the hour is missing", () => {
    expect(covering([at(0), at(2 * HOUR)], HOUR + 1)).toBeUndefined();
    expect(covering(candles, 99 * HOUR)).toBeUndefined();
    expect(covering([], HOUR)).toBeUndefined();
  });
});

describe("isTraded", () => {
  it("accepts an hour that carried real volume", () => {
    expect(isTraded(at(0, { quoteVolume: MIN_QUOTE_VOLUME_USD }))).toBe(true);
  });

  // VIRTUAL traded nothing at all in the hour containing the fork block. Its
  // candle repeats the previous hour's close, and on that the probe had
  // returned PASS: "the pool prices it like the wider market."
  it("refuses an hour in which nothing changed hands", () => {
    expect(isTraded(at(0, { quoteVolume: 0 }))).toBe(false);
    expect(isTraded(at(0, { quoteVolume: MIN_QUOTE_VOLUME_USD - 1 }))).toBe(false);
  });
});

describe("midPrice", () => {
  it("is the mid of the candle that was open at that moment", () => {
    expect(midPrice(at(0, { open: 2, close: 4 }))).toBe(3);
  });
});
