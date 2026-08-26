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
}

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
    if (!Array.isArray(r) || r.length < 7) continue;
    const openTimeMs = Number(r[0]);
    const closeTimeMs = Number(r[6]);
    if (ms < openTimeMs || ms > closeTimeMs) continue;
    return { openTimeMs, closeTimeMs, open: Number(r[1]), close: Number(r[4]) };
  }
  return undefined;
}

/** Mid of the candle that was open at that moment. */
export function midPrice(c: Candle): number {
  return (c.open + c.close) / 2;
}
