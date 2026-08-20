import type { RawResult, ProbeCtx, Verdict, Hex, Probe } from "@sidik/shared";
import { buyBudget, buyExactEth, sellAll } from "../dex.js";

export function interpretHoneypot(raw: RawResult, _ctx: ProbeCtx): Verdict {
  const bought = String(raw.boughtAmount ?? "0");
  const soldOk = Boolean(raw.soldOk);
  const txHashes = [raw.buyTxHash as Hex, raw.sellTxHash as Hex].filter((h) => h && h !== "0x") as Hex[];

  if (bought === "0") {
    return {
      probe: "honeypot", status: "NA", title: "Could not buy — no liquidity to test",
      rows: [{ label: "Buy the token", claimed: "Tradable", proven: "Buy did not yield tokens", ok: false }],
      numbers: { boughtAmount: bought }, txHashes,
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
      buyTxHash: buy.hash, sellTxHash: sell.hash,
    };
  },
  interpret: interpretHoneypot,
};
