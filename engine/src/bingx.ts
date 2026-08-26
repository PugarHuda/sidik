// BingX public market data. No key, no account — the spot symbol list and the
// candle history are open endpoints.
//
// This exists so a verdict can be checked against a venue that has nothing to
// do with the pool Sidik traded in. A token you cannot sell cannot sustain a
// working market somewhere else, and a price that only holds inside one pool
// is a different thing from a price the wider market agrees on.
const BASE = process.env.BINGX_BASE_URL ?? "https://open-api.bingx.com";

// One hour is the shortest candle that reliably exists for thin pairs. The
// window either contains the fork block or the pair was not trading then, and
// the second case has to be reported rather than guessed around.
const INTERVAL = "1h";
const HOUR_MS = 3_600_000;

// Market data is a nicety; the fork proof is the product. If the venue is
// slow the probe reports that it could not price, rather than stalling.
const VENUE_TIMEOUT_MS = 8_000;

export interface Candle {
  openTimeMs: number;
  closeTimeMs: number;
  open: number;
  close: number;
  /** Base-asset units traded in the hour. */
  volume: number;
  /** Value traded in the hour, in the quote asset (USDT). */
  quoteVolume: number;
}

/**
 * Below this, an hour's price is not a market price.
 *
 * The candle endpoint returns volume alongside the prices, and this code read
 * only open and close — so a completely still hour was quoted with exactly
 * the confidence of a busy one.
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

/**
 * The candle whose window contains `atUnixSeconds`, or undefined if the pair
 * was not trading then. Never the nearest candle: substituting a different
 * hour's price for the one asked about is a fabricated comparison.
 */
export async function candleAt(symbol: string, atUnixSeconds: number): Promise<Candle | undefined> {
  const ms = atUnixSeconds * 1000;
  const url = `${BASE}/openApi/spot/v2/market/kline?symbol=${encodeURIComponent(symbol)}`
    + `&interval=${INTERVAL}&startTime=${ms - 2 * HOUR_MS}&endTime=${ms + HOUR_MS}&limit=10`;
  let rows: unknown[];
  try {
    // Node's fetch has no default timeout: a venue that accepts the
    // connection and then stops talking would hang this probe, and with it
    // the whole run, forever.
    const res = await fetch(url, {
      headers: { "user-agent": "sidik" },
      signal: AbortSignal.timeout(VENUE_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const body = await res.json() as { data?: unknown[] };
    rows = body.data ?? [];
  } catch {
    return undefined; // venue unreachable — the probe reports that, it does not invent a price
  }

  for (const row of rows) {
    // [openTime, open, high, low, close, volume, closeTime, quoteVolume]
    const r = row as [number, number, number, number, number, number, number, number];
    if (!Array.isArray(r) || r.length < 8) continue;
    const openTimeMs = Number(r[0]);
    const closeTimeMs = Number(r[6]);
    if (ms < openTimeMs || ms > closeTimeMs) continue;
    return {
      openTimeMs, closeTimeMs,
      open: Number(r[1]), close: Number(r[4]),
      volume: Number(r[5]) || 0,
      quoteVolume: Number(r[7]) || 0,
    };
  }
  return undefined;
}

/** Whether the hour carried enough trade for its price to mean anything. */
export function isTraded(c: Candle): boolean {
  return c.quoteVolume >= MIN_QUOTE_VOLUME_USD;
}

/** Mid of the candle that was open at that moment. */
export function midPrice(c: Candle): number {
  return (c.open + c.close) / 2;
}
