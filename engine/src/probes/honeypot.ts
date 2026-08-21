import type { RawResult, ProbeCtx, Verdict, Hex, Probe } from "@sidik/shared";
import { buyBudget, buyExactEth, sellAll } from "../dex.js";
import { amount } from "../format.js";

// A sell that goes through but hands back a sliver of what the pool owes you
// is a honeypot by any measure that matters — your money is still gone. Above
// this share of the quote it is a fee, and hiddenFee reports it as one.
const MIN_SELL_PROCEEDS_PCT = 10n;

export function interpretHoneypot(raw: RawResult, ctx: ProbeCtx): Verdict {
  // Optional chaining because interpret is unit-tested with a bare ctx.
  const dec = ctx?.scan?.decimals ?? 18;
  const sym = ctx?.scan?.symbol || undefined;
  const bought = amount(String(raw.boughtAmount ?? "0"), dec, sym);
  const soldOk = Boolean(raw.soldOk);
  const sellPredicted = BigInt(String(raw.sellPredicted ?? "0"));
  const sellReceived = BigInt(String(raw.sellReceived ?? "0"));
  // Only judgeable when the pool actually quoted the trade.
  const proceedsGutted = soldOk && sellPredicted > 0n
    && sellReceived * 100n < sellPredicted * MIN_SELL_PROCEEDS_PCT;
  const txHashes = [raw.buyTxHash as Hex, raw.sellTxHash as Hex].filter((h) => h && h !== "0x") as Hex[];

  if (bought === "0") {
    return {
      probe: "honeypot", status: "NA", title: "Could not buy — no liquidity to test",
      rows: [{ label: "Buy the token", claimed: "Tradable", proven: "Buy did not yield tokens", ok: false }],
      numbers: { boughtAmount: bought }, txHashes,
    };
  }
  if (proceedsGutted) {
    return {
      probe: "honeypot", status: "FAIL", title: "Honeypot — the sell goes through but pays almost nothing",
      rows: [{ label: "Sell after buying", claimed: "Freely tradable",
        proven: "Sell succeeded, but the pool paid out a sliver of what it quoted", ok: false }],
      numbers: { boughtAmount: bought, sellQuoted: amount(sellPredicted, 18, "WETH"), sellPaid: amount(sellReceived, 18, "WETH") },
      txHashes,
      reason: "the sell did not revert; the proceeds were taken instead",
    };
  }

  if (!soldOk) {
    return {
      probe: "honeypot", status: "FAIL", title: "Honeypot — you can buy but cannot sell",
      rows: [{ label: "Sell after buying", claimed: "Freely tradable", proven: "Sell reverted", ok: false }],
      numbers: { boughtAmount: bought }, txHashes,
      reason: String(raw.sellRevertReason ?? "sell reverted"),
    };
  }
  return {
    probe: "honeypot", status: "PASS", title: "Not a honeypot — buy and sell both succeed",
    rows: [{ label: "Sell after buying", claimed: "Freely tradable", proven: "Sell succeeded", ok: true }],
    numbers: { boughtAmount: bought }, txHashes,
  };
}

export const honeypotProbe: Probe = {
  id: "honeypot",
  title: "Honeypot sell test",
  applicableWhen: (s) => s.isErc20 && s.hasPool,
  async setup(fork, ctx) {
    await fork.setBalanceEth(ctx.testWallet, "10");
  },
  async execute(fork, ctx): Promise<RawResult> {
    const buy = await buyExactEth(fork, ctx, await buyBudget(fork, ctx));
    if (!buy.ok || buy.amount === "0") {
      return { boughtAmount: "0", soldOk: false, buyTxHash: buy.hash, sellTxHash: "0x" as Hex };
    }
    const sell = await sellAll(fork, ctx);
    return {
      boughtAmount: buy.amount, soldOk: sell.ok, sellRevertReason: sell.revertReason,
      sellPredicted: sell.predicted, sellReceived: sell.received,
      buyTxHash: buy.hash, sellTxHash: sell.hash,
    };
  },
  interpret: interpretHoneypot,
};
