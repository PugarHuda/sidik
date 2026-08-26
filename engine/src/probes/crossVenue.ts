import { createPublicClient, formatUnits, http } from "viem";
import { base } from "viem/chains";
import type { RawResult, ProbeCtx, Verdict, Hex, Probe } from "@sidik/shared";
import { listedTicker } from "@sidik/shared";
import { buyBudget, buyExactEth } from "../dex.js";
import { candleAt, isTraded, midPrice } from "../bingx.js";

// What a buy actually costs inside the pool, against what the same asset cost
// on a venue that has never heard of that pool, at the same moment.
//
// The gap is not free money and is not fraud on its own. Three things live
// inside it: the pool's own fee tier, the price impact of the trade Sidik
// made, and any genuine spread between venues. On the trade sizes used here
// the first two are small, so a large gap means buying through this pool cost
// materially more than the market price — which is a real cost to a buyer
// whatever its cause.
const MAX_REASONABLE_PREMIUM_PCT = 25;

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

export function interpretCrossVenue(raw: RawResult, _ctx: ProbeCtx): Verdict {
  const ticker = String(raw.ticker ?? "");
  const label = "Price inside the pool vs. an independent venue";
  const claimed = "The pool prices it like the wider market";

  if (raw.unavailable) {
    return {
      probe: "crossVenue", status: "NA",
      title: `No BingX price for ${ticker} at the forked block`,
      rows: [{ label, claimed, proven: String(raw.unavailable), ok: false }],
      numbers: { venue: "bingx", ticker }, txHashes: [],
    };
  }

  const onchain = Number(raw.onchainUsd ?? 0);
  const venue = Number(raw.venueUsd ?? 0);
  const premium = Number(raw.premiumPct ?? 0);
  const numbers = {
    venue: "bingx",
    ticker,
    onchainPrice: usd(onchain),
    bingxPrice: usd(venue),
    difference: pct(premium),
    ethSpent: String(raw.ethSpent ?? ""),
  };
  const txHashes = [raw.buyTxHash as Hex].filter((h) => h && h !== "0x") as Hex[];

  if (premium > MAX_REASONABLE_PREMIUM_PCT) {
    return {
      probe: "crossVenue", status: "FAIL",
      title: `Buying through the pool cost ${pct(premium)} more than the market price`,
      rows: [{ label, claimed,
        proven: `Paid ${usd(onchain)} per token in the pool while BingX traded it at ${usd(venue)}`,
        ok: false }],
      numbers, txHashes,
    };
  }

  return {
    probe: "crossVenue", status: "PASS",
    title: `Pool price matches the market within ${pct(premium)}`,
    rows: [{ label, claimed,
      proven: `Paid ${usd(onchain)} per token in the pool; BingX traded it at ${usd(venue)} in the same hour`,
      ok: true }],
    numbers, txHashes,
  };
}

export const crossVenueProbe: Probe = {
  id: "crossVenue",
  title: "Cross-venue price check",
  // Only for tokens whose BingX ticker has been verified by hand to be the
  // same asset. Exchange tickers collide, and comparing a Base memecoin
  // against a different coin that shares three letters would be worse than
  // reporting nothing.
  applicableWhen: (s) => s.isErc20 && s.hasPool && Boolean(listedTicker(s.token)),
  async setup(fork, ctx) {
    await fork.setBalanceEth(ctx.testWallet, "10");
  },
  async execute(fork, ctx): Promise<RawResult> {
    const ticker = listedTicker(ctx.token)!;

    const ethIn = await buyBudget(fork, ctx);
    const buy = await buyExactEth(fork, ctx, ethIn);
    const bought = BigInt(buy.amount);
    if (!buy.ok || bought === 0n) {
      return { ticker, unavailable: "Could not buy the token on the fork, so there is no pool price to compare" };
    }

    // The forked block's own timestamp, so both sides of the comparison
    // describe the same moment. Pricing a pinned fork against the venue's
    // current price would be comparing two different days and calling the
    // difference a spread.
    let at = 0;
    try {
      const pub = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });
      at = Number((await pub.getBlock({ blockNumber: ctx.block })).timestamp);
    } catch {
      return { ticker, unavailable: "Could not read the forked block's timestamp to price against" };
    }

    const [tokenCandle, ethCandle] = await Promise.all([
      candleAt(`${ticker}-USDT`, at),
      candleAt("ETH-USDT", at),
    ]);
    if (!tokenCandle) {
      return { ticker, unavailable: `${ticker} was not trading on BingX during that hour` };
    }
    if (!ethCandle) {
      return { ticker, unavailable: "No ETH price for that hour, so the pool price cannot be put in dollars" };
    }
    // A candle exists but nothing moved in it. The price is then the last
    // print from some earlier hour, and calling it "what the wider market
    // paid" would be describing a market that was not open for business.
    if (!isTraded(tokenCandle)) {
      // Said differently when the hour is genuinely empty: "traded only $0" is
      // a stranger sentence than the plain fact.
      const how = tokenCandle.quoteVolume === 0
        ? `${ticker} did not trade on BingX at all in that hour`
        : `BingX traded only ${usd(tokenCandle.quoteVolume)} of ${ticker} in that hour`;
      return {
        ticker,
        unavailable: `${how} — too thin for its price to stand as a market comparison`,
      };
    }
    if (!isTraded(ethCandle)) {
      return { ticker, unavailable: "The ETH market was too thin in that hour to convert the pool price into dollars" };
    }

    const ethUsd = midPrice(ethCandle);
    const venueUsd = midPrice(tokenCandle);
    const tokens = Number(formatUnits(bought, ctx.scan.decimals));
    const spentEth = Number(formatUnits(ethIn, 18));
    if (tokens <= 0 || spentEth <= 0 || venueUsd <= 0) {
      return { ticker, unavailable: "The trade produced no usable price" };
    }

    const onchainUsd = (spentEth * ethUsd) / tokens;
    const premiumPct = ((onchainUsd - venueUsd) / venueUsd) * 100;

    return {
      ticker,
      onchainUsd,
      venueUsd,
      premiumPct,
      ethSpent: `${spentEth} ETH`,
      buyTxHash: buy.hash,
    };
  },
  interpret: interpretCrossVenue,
};
