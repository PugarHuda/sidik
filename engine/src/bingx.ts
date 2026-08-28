import { covering, HOUR_MS, VENUE_TIMEOUT_MS, type Candle, type Venue } from "./venue.js";

// BingX public market data. No key, no account — the spot symbol list and the
// candle history are open endpoints.
//
// This exists so a verdict can be checked against a venue that has nothing to
// do with the pool Sidik traded in. A token you cannot sell cannot sustain a
// working market somewhere else, and a price that only holds inside one pool
// is a different thing from a price the wider market agrees on.
const BASE = process.env.BINGX_BASE_URL ?? "https://open-api.bingx.com";

/**
 * The authoritative list of what BingX quotes.
 *
 * Not the per-symbol /ticker/24hr endpoint: that comes back empty for plenty
 * of symbols BingX genuinely lists, and reading it as a listing check nearly
 * produced a false finding that four confirmed pairs had been delisted.
 */
export const BINGX_SYMBOLS = `${BASE}/openApi/spot/v1/common/symbols`;

export const bingx: Venue = {
  id: "bingx",
  name: "BingX",
  pair: (ticker) => `${ticker}-USDT`,
  async candleAt(pair, atUnixSeconds) {
    const ms = atUnixSeconds * 1000;
    const url = `${BASE}/openApi/spot/v2/market/kline?symbol=${encodeURIComponent(pair)}`
      + `&interval=1h&startTime=${ms - 2 * HOUR_MS}&endTime=${ms + HOUR_MS}&limit=10`;
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

    const candles: Candle[] = [];
    for (const row of rows) {
      // [openTime, open, high, low, close, volume, closeTime, quoteVolume]
      const r = row as number[];
      if (!Array.isArray(r) || r.length < 8) continue;
      candles.push({
        openTimeMs: Number(r[0]),
        closeTimeMs: Number(r[6]),
        open: Number(r[1]),
        close: Number(r[4]),
        quoteVolume: Number(r[7]) || 0,
      });
    }
    return covering(candles, ms);
  },
};
