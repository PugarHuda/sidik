import { covering, HOUR_MS, VENUE_TIMEOUT_MS, type Candle, type Venue } from "./venue";

/**
 * Gate.io public market data. No key, no account.
 *
 * Gate is here for something BingX cannot offer: it publishes the contract
 * address behind every ticker it lists, per chain. That turns "this Base
 * token is the same asset as that exchange symbol" from a judgement someone
 * made by hand into something the venue itself asserts — which is the whole
 * risk in a cross-venue check. Exchange tickers collide constantly, and this
 * catalogue shares DOS, MON, SYS, HYPER and BSV with unrelated coins.
 *
 * See engine/scripts/gen-listings.mts for where that mapping is read.
 */
const BASE = process.env.GATE_BASE_URL ?? "https://api.gateio.ws";

/**
 * Where Gate publishes every currency it lists, with a `chains[]` array
 * carrying the chain name and contract address. Base entries are named
 * BASEEVM; 152 of them existed when this was written.
 */
const GATE_CURRENCIES = `${BASE}/api/v4/spot/currencies`;

export interface GateChainEntry {
  currency: string;
  address: string;
  /** Gate has stopped quoting it, which is itself worth knowing. */
  tradeDisabled: boolean;
  delisted: boolean;
}

/** Every Base-chain contract Gate lists, keyed by lowercased address. */
export async function baseListings(): Promise<Map<string, GateChainEntry>> {
  const res = await fetch(GATE_CURRENCIES, {
    headers: { accept: "application/json", "user-agent": "sidik" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Gate returned ${res.status} for the currency list`);
  const body = await res.json() as {
    currency: string; delisted?: boolean; trade_disabled?: boolean;
    chains?: { name?: string; addr?: string }[];
  }[];

  const out = new Map<string, GateChainEntry>();
  for (const cur of body) {
    for (const chain of cur.chains ?? []) {
      if (String(chain.name).toUpperCase() !== "BASEEVM" || !chain.addr) continue;
      out.set(chain.addr.toLowerCase(), {
        currency: cur.currency,
        address: chain.addr,
        tradeDisabled: Boolean(cur.trade_disabled),
        delisted: Boolean(cur.delisted),
      });
    }
  }
  return out;
}

export const gate: Venue = {
  id: "gate",
  name: "Gate",
  pair: (ticker) => `${ticker}_USDT`,
  async candleAt(pair, atUnixSeconds) {
    const from = atUnixSeconds - 2 * (HOUR_MS / 1000);
    const to = atUnixSeconds + HOUR_MS / 1000;
    const url = `${BASE}/api/v4/spot/candlesticks?currency_pair=${encodeURIComponent(pair)}`
      + `&interval=1h&from=${Math.floor(from)}&to=${Math.floor(to)}`;
    let rows: unknown[];
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "sidik" },
        signal: AbortSignal.timeout(VENUE_TIMEOUT_MS),
      });
      if (!res.ok) return undefined;
      rows = await res.json() as unknown[];
    } catch {
      return undefined; // venue unreachable — the probe reports that, it does not invent a price
    }
    if (!Array.isArray(rows)) return undefined;

    // Gate's row is [seconds, quoteVolume, close, high, low, open, baseVolume,
    // windowClosed] — note that the volume comes SECOND and the open comes
    // sixth, which is not the order BingX or most venues use. Verified against
    // the hour containing the fork block: base volume 1,034,290 at a mid of
    // ~0.004195 reproduces the quoted 4,339.19 quote volume, and high/low
    // bracket both open and close.
    const candles: Candle[] = [];
    for (const row of rows) {
      const r = row as string[];
      if (!Array.isArray(r) || r.length < 6) continue;
      const openTimeMs = Number(r[0]) * 1000;
      if (!Number.isFinite(openTimeMs)) continue;
      candles.push({
        openTimeMs,
        closeTimeMs: openTimeMs + HOUR_MS - 1,
        open: Number(r[5]),
        close: Number(r[2]),
        quoteVolume: Number(r[1]) || 0,
      });
    }
    return covering(candles, atUnixSeconds * 1000);
  },
};
