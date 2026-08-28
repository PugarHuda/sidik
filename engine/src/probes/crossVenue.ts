import { createPublicClient, formatUnits } from "viem";
import { base } from "viem/chains";
import { forkTransport } from "../fork.js";
import type { RawResult, ProbeCtx, Verdict, Hex, Probe } from "@sidik/shared";
import { venueListings } from "@sidik/shared";
import { buyBudget, buyExactEth } from "../dex.js";
import { bingx } from "../bingx.js";
import { gate } from "../gate.js";
import { isTraded, midPrice, type Venue } from "../venue.js";

// What a buy actually costs inside the pool, against what the same asset cost
// on venues that have never heard of that pool, at the same moment.
//
// The gap is not free money and is not fraud on its own. Three things live
// inside it: the pool's own fee tier, the price impact of the trade Sidik
// made, and any genuine spread between venues. On the trade sizes used here
// the first two are small, so a large gap means buying through this pool cost
// materially more than the market price — which is a real cost to a buyer
// whatever its cause.
const MAX_REASONABLE_PREMIUM_PCT = 25;

const VENUES: Record<string, Venue> = { bingx, gate };

function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2).replace(/\.00$/, "")}%`;
}

export function usd(n: number): string {
  // Zero and the non-finite cases first. log10(0) is -Infinity, which made the
  // digit count Infinity, which capped at ten — so an hour with no trading at
  // all was reported as "$0.0000000000", ten decimal places of nothing.
  if (!Number.isFinite(n)) return "$—";
  if (n === 0) return "$0";
  const abs = Math.abs(n);
  // Memecoins price in millionths; a fixed 2dp would render every one as 0.00.
  const digits = abs >= 1 ? 2 : Math.min(10, Math.max(4, Math.ceil(-Math.log10(abs)) + 3));
  return `$${n.toFixed(digits)}`;
}

interface Quote {
  venue: string;
  name: string;
  ticker: string;
  venueUsd: number;
  onchainUsd: number;
  premiumPct: number;
}

export function interpretCrossVenue(raw: RawResult, _ctx: ProbeCtx): Verdict {
  const label = "Price inside the pool vs. independent venues";
  const claimed = "The pool prices it like the wider market";
  const quotes = (raw.quotes ?? []) as Quote[];
  const asked = (raw.asked ?? []) as { name: string; ticker: string }[];
  const askedText = asked.map((a) => `${a.name} (${a.ticker})`).join(" and ") || "any venue";

  if (!quotes.length) {
    return {
      probe: "crossVenue", status: "NA",
      title: `No usable ${askedText} price at the forked block`,
      rows: [{ label, claimed, proven: String(raw.unavailable ?? "No venue could price it"), ok: false }],
      numbers: { venuesAsked: askedText }, txHashes: [],
    };
  }

  // The venue most favourable to the token decides the verdict. A finding
  // against a token should never rest on whichever book happened to be
  // thinnest — but every book asked is shown, so nothing is hidden either.
  const best = quotes.reduce((a, b) => (b.premiumPct < a.premiumPct ? b : a));
  const numbers: Record<string, string> = {
    venuesAsked: askedText,
    venue: best.venue,
    ticker: best.ticker,
    onchainPrice: usd(best.onchainUsd),
    difference: pct(best.premiumPct),
    ethSpent: String(raw.ethSpent ?? ""),
  };
  for (const q of quotes) numbers[`${q.venue}Price`] = usd(q.venueUsd);
  const txHashes = [raw.buyTxHash as Hex].filter((h) => h && h !== "0x") as Hex[];

  const rows = quotes.map((q) => ({
    label: quotes.length > 1 ? `${label} — ${q.name}` : label,
    claimed,
    proven: `Paid ${usd(q.onchainUsd)} per token in the pool; ${q.name} traded ${q.ticker} at `
      + `${usd(q.venueUsd)} in the same hour (${pct(q.premiumPct)})`,
    ok: q.premiumPct <= MAX_REASONABLE_PREMIUM_PCT,
  }));

  if (best.premiumPct > MAX_REASONABLE_PREMIUM_PCT) {
    return {
      probe: "crossVenue", status: "FAIL",
      title: `Buying through the pool cost ${pct(best.premiumPct)} more than the market price`,
      rows, numbers, txHashes,
    };
  }

  return {
    probe: "crossVenue", status: "PASS",
    title: quotes.length > 1
      ? `Pool price matches ${quotes.length} independent venues within ${pct(best.premiumPct)}`
      : `Pool price matches the market within ${pct(best.premiumPct)}`,
    rows, numbers, txHashes,
  };
}

export const crossVenueProbe: Probe = {
  id: "crossVenue",
  title: "Cross-venue price check",
  // Only for tokens a venue is known to quote. BingX pairs were matched by
  // hand because exchange tickers collide; Gate pairs were matched against
  // the contract address the exchange itself publishes.
  applicableWhen: (s) => s.isErc20 && s.hasPool && venueListings(s.token).length > 0,
  async setup(fork, ctx) {
    await fork.setBalanceEth(ctx.testWallet, "10");
  },
  async execute(fork, ctx): Promise<RawResult> {
    const listings = venueListings(ctx.token);
    const asked = listings.map((l) => ({ name: VENUES[l.venue]!.name, ticker: l.ticker }));

    const ethIn = await buyBudget(fork, ctx);
    const buy = await buyExactEth(fork, ctx, ethIn);
    const bought = BigInt(buy.amount);
    if (!buy.ok || bought === 0n) {
      return { asked, quotes: [], unavailable: "Could not buy the token on the fork, so there is no pool price to compare" };
    }

    // The forked block's own timestamp, so both sides of the comparison
    // describe the same moment. Pricing a pinned fork against a venue's
    // current price would be comparing two different days and calling the
    // difference a spread.
    let at = 0;
    try {
      const pub = createPublicClient({ chain: base, transport: forkTransport(fork.rpcUrl) });
      at = Number((await pub.getBlock({ blockNumber: ctx.block })).timestamp);
    } catch {
      return { asked, quotes: [], unavailable: "Could not read the forked block's timestamp to price against" };
    }

    const tokens = Number(formatUnits(bought, ctx.scan.decimals));
    const spentEth = Number(formatUnits(ethIn, 18));
    if (tokens <= 0 || spentEth <= 0) {
      return { asked, quotes: [], unavailable: "The trade produced no usable price" };
    }

    const quotes: Quote[] = [];
    const why: string[] = [];
    for (const listing of listings) {
      const venue = VENUES[listing.venue];
      if (!venue) continue;
      // The token and the ETH leg come from the SAME book. Converting a pool
      // price into dollars with one venue's ETH and comparing it against
      // another venue's token print would put the spread between two
      // exchanges inside a number that is supposed to describe one pool.
      const [tokenCandle, ethCandle] = await Promise.all([
        venue.candleAt(venue.pair(listing.ticker), at),
        venue.candleAt(venue.pair("ETH"), at),
      ]);
      if (!tokenCandle) { why.push(`${listing.ticker} was not trading on ${venue.name} during that hour`); continue; }
      if (!ethCandle) { why.push(`${venue.name} had no ETH price for that hour`); continue; }
      // A candle exists but nothing moved in it. The price is then the last
      // print from some earlier hour, and calling it "what the wider market
      // paid" would be describing a market that was not open for business.
      if (!isTraded(tokenCandle)) {
        why.push(tokenCandle.quoteVolume === 0
          ? `${listing.ticker} did not trade on ${venue.name} at all in that hour`
          : `${venue.name} traded only ${usd(tokenCandle.quoteVolume)} of ${listing.ticker} in that hour`);
        continue;
      }
      if (!isTraded(ethCandle)) { why.push(`${venue.name}'s ETH market was too thin in that hour`); continue; }

      const venueUsd = midPrice(tokenCandle);
      if (venueUsd <= 0) { why.push(`${venue.name} quoted ${listing.ticker} at zero`); continue; }
      const onchainUsd = (spentEth * midPrice(ethCandle)) / tokens;
      quotes.push({
        venue: venue.id, name: venue.name, ticker: listing.ticker,
        venueUsd, onchainUsd,
        premiumPct: ((onchainUsd - venueUsd) / venueUsd) * 100,
      });
    }

    return {
      asked, quotes,
      unavailable: quotes.length ? undefined
        : `${why.join("; ")} — too thin for a price to stand as a market comparison`,
      ethSpent: `${spentEth} ETH`,
      buyTxHash: buy.hash,
    };
  },
  interpret: interpretCrossVenue,
};
