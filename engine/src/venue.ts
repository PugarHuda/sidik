/**
 * What every independent venue has to provide, and the rules that apply to
 * all of them.
 *
 * Sidik compares the price it paid inside one pool against the price the same
 * asset traded at somewhere with no relationship to that pool. The venue is
 * interchangeable; the rules about when a venue's price is usable are not,
 * and they were previously written once, inside the BingX client, where a
 * second venue could not reach them.
 */

export interface Candle {
  openTimeMs: number;
  closeTimeMs: number;
  open: number;
  close: number;
  /** Value traded in the window, in the quote asset (USDT). */
  quoteVolume: number;
}

export interface Venue {
  /** Stable id, recorded in the verdict so a reader knows who was asked. */
  id: string;
  /** Human name for prose. */
  name: string;
  /** How this venue writes the pair for `base` against USDT. */
  pair(ticker: string): string;
  /**
   * The candle whose window contains `atUnixSeconds`, or undefined if the
   * pair was not trading then. Never the nearest candle: substituting another
   * hour's price for the one asked about is a fabricated comparison.
   */
  candleAt(pair: string, atUnixSeconds: number): Promise<Candle | undefined>;
}

/**
 * Below this, an hour's price is not a market price.
 *
 * Candle endpoints return volume alongside the prices, and the first version
 * of this code read only open and close — so a completely still hour was
 * quoted with exactly the confidence of a busy one.
 *
 * Measured in the hour containing block 50,200,000 (unix 1787189347, the
 * timestamp the probe actually reads off the fork): USDC traded $2,843,558,
 * ETH $7,501,536, AERO $12,318, BRETT $1,763, TOSHI $1,576 — and VIRTUAL
 * traded nothing at all. Zero. Its candle carries the previous hour's closing
 * print, and on that basis the probe had returned PASS: "the pool prices it
 * like the wider market."
 *
 * A thousand dollars sits inside the wide gap between VIRTUAL and TOSHI
 * rather than at a round number picked for its own sake. Below it the probe
 * says it could not price the token, which is what actually happened.
 */
export const MIN_QUOTE_VOLUME_USD = 1_000;

/** Market data is a nicety; the fork proof is the product. */
export const VENUE_TIMEOUT_MS = 8_000;

/** One hour is the shortest candle that reliably exists for thin pairs. */
export const HOUR_MS = 3_600_000;

/** Whether the hour carried enough trade for its price to mean anything. */
export function isTraded(c: Candle): boolean {
  return c.quoteVolume >= MIN_QUOTE_VOLUME_USD;
}

/** Mid of the candle that was open at that moment. */
export function midPrice(c: Candle): number {
  return (c.open + c.close) / 2;
}

/** The candle covering `ms`, or undefined. Shared by every venue client. */
export function covering(candles: Candle[], ms: number): Candle | undefined {
  return candles.find((c) => ms >= c.openTimeMs && ms <= c.closeTimeMs);
}
