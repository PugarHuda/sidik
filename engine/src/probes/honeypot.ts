import { encodeFunctionData } from "viem";
import type { RawResult, ProbeCtx, Verdict, Hex, Probe } from "@sidik/shared";
import { buyBudget, buyExactEth, sellAll } from "../dex.js";
import { amount } from "../format.js";
import { ERC20_ABI } from "../abi.js";
import { PROBE_RECIPIENT } from "../base.js";

// A sell that goes through but hands back a sliver of what the pool owes you
// is a honeypot by any measure that matters — your money is still gone. Above
// this share of the quote it is a fee, and hiddenFee reports it as one.
const MIN_SELL_PROCEEDS_PCT = 10n;

// When the whole position will not sell, try this much of it. A max-tx or
// max-sell cap is the commonest reason a Base meme token refuses a sell, and
// a cap is not a honeypot: the holder can leave, in pieces. Ten percent of a
// buy that was itself two percent of the pool is small enough to clear any
// cap that would still let a real holder out.
const PARTIAL_SELL_DIVISOR = 10n;

// How much of the position is moved to measure whether the token skims plain
// transfers. Enough to be above dust rounding, small enough not to matter.
const SKIM_PROBE_DIVISOR = 100n;

function shortfallBps(expected: bigint, got: bigint): number {
  if (expected <= 0n || got >= expected) return 0;
  return Number(((expected - got) * 10_000n) / expected);
}

export function interpretHoneypot(raw: RawResult, ctx: ProbeCtx): Verdict {
  // Optional chaining because interpret is unit-tested with a bare ctx.
  const dec = ctx?.scan?.decimals ?? 18;
  const sym = ctx?.scan?.symbol || undefined;
  // Keep the raw value for the "did we buy anything at all" test. Formatting
  // turns "0" into "0 SYMBOL", and comparing the formatted string missed
  // the no-liquidity branch — five tokens we simply could not buy were
  // accused of being honeypots instead.
  const rawBought = String(raw.boughtAmount ?? "0");
  const bought = amount(rawBought, dec, sym);
  const soldOk = Boolean(raw.soldOk);
  const sellPredicted = BigInt(String(raw.sellPredicted ?? "0"));
  const sellReceived = BigInt(String(raw.sellReceived ?? "0"));
  // Only judgeable when the pool actually quoted the trade.
  const proceedsGutted = soldOk && sellPredicted > 0n
    && sellReceived * 100n < sellPredicted * MIN_SELL_PROCEEDS_PCT;
  const txHashes = [raw.buyTxHash, raw.sellTxHash, raw.partialSellTxHash, raw.skimTxHash]
    .filter((h) => h && h !== "0x") as Hex[];

  if (rawBought === "0") {
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
    const fullReason = String(raw.sellRevertReason ?? "sell reverted");
    const retried = raw.sellRetried === true;
    const partialOk = raw.partialSoldOk === true;
    const partialAmount = amount(String(raw.partialAmount ?? "0"), dec, sym);
    const skimBps = Number(raw.transferSkimBps ?? 0);
    const skimPct = `${(skimBps / 100).toFixed(2).replace(/[.]?0+$/, "")}%`;

    // The whole position would not sell, a tenth of it did. That is a cap on
    // the size of a sell, which is a real cost to a holder — leaving takes
    // several transactions, each paying the pool again — but it is not a
    // trap. A holder can leave.
    if (retried && partialOk) {
      return {
        probe: "honeypot", status: "PASS",
        title: `Not a honeypot — but sells are capped: the whole position reverted, ${partialAmount} sold`,
        rows: [{ label: "Sell after buying", claimed: "Freely tradable",
          proven: `Selling everything reverted (${fullReason}); selling a tenth of it went through`, ok: true }],
        numbers: {
          boughtAmount: bought, partialSell: "succeeded", partialSold: partialAmount,
          partialProceeds: amount(String(raw.partialReceived ?? "0"), 18, "WETH"),
        },
        txHashes,
        reason: fullReason,
      };
    }

    const numbers: Record<string, string> = { boughtAmount: bought };
    if (retried) {
      numbers.partialSell = "reverted";
      numbers.transferSkim = raw.transferReverted ? "transfer reverted" : skimPct;
    }

    // Both sizes reverted, and the token takes a cut off every plain transfer.
    // That combination on a Uniswap V3 pool is not a switch in the contract
    // saying no: V3 requires the exact input to arrive and rejects the swap
    // (IIA) when it does not, so a token that skims cannot be sold into V3 by
    // anyone, through any router. The holder's outcome is the same — bought,
    // cannot sell — and the verdict stays FAIL. The cause is named because a
    // reader who takes "honeypot" to mean a deliberate trap would be told
    // something the run did not establish.
    if (retried && skimBps > 0 && ctx?.scan?.venue === "v3") {
      return {
        probe: "honeypot", status: "FAIL",
        title: `Cannot sell — the token skims ${skimPct} off every transfer, and Uniswap V3 rejects a token that arrives short`,
        rows: [{ label: "Sell after buying", claimed: "Freely tradable",
          proven: `Selling everything reverted (${fullReason}), and so did selling a tenth. A plain transfer of ${amount(String(raw.skimAmount ?? "0"), dec, sym)} arrived ${skimPct} short, which is what V3's swap callback refuses`,
          ok: false }],
        numbers, txHashes, reason: fullReason,
      };
    }

    return {
      probe: "honeypot", status: "FAIL", title: "Honeypot — you can buy but cannot sell",
      rows: [{ label: "Sell after buying", claimed: "Freely tradable",
        proven: retried
          ? `Selling everything reverted, and so did selling a tenth of it (${String(raw.partialRevertReason ?? fullReason)})`
          : "Sell reverted",
        ok: false }],
      numbers, txHashes,
      reason: fullReason,
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
    const base = {
      boughtAmount: buy.amount, soldOk: sell.ok, sellRevertReason: sell.revertReason,
      sellPredicted: sell.predicted, sellReceived: sell.received,
      buyTxHash: buy.hash, sellTxHash: sell.hash,
    };
    if (sell.ok) return base;

    // The whole position would not sell. Two more things are worth knowing
    // before that is called a honeypot, and both are found by executing.
    //
    // One: is it a cap rather than a block? A tenth of the position is tried.
    // The first sell reverted, so the state it ran against is unchanged and
    // this is the same question at a smaller size, not a second attempt after
    // something moved.
    const bought = BigInt(buy.amount);
    const tenth = bought / PARTIAL_SELL_DIVISOR;
    const partial = tenth > 0n ? await sellAll(fork, ctx, tenth) : undefined;

    // Two: does the token take a cut off a plain transfer? On Uniswap V3 that
    // alone makes every sell revert with IIA — the pool never receives what
    // the router said it sent — which is a different fact from a contract
    // refusing to let a holder out, and the verdict says which it found.
    let transferSkimBps = 0;
    let transferReverted = false;
    let skimTxHash: Hex = "0x" as Hex;
    const skimAmount = bought / SKIM_PROBE_DIVISOR;
    if (skimAmount > 0n) {
      const before = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [PROBE_RECIPIENT] });
      const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [PROBE_RECIPIENT, skimAmount] });
      const tx = await fork.send({ from: ctx.testWallet, to: ctx.token, data });
      skimTxHash = tx.hash;
      if (tx.reverted) {
        transferReverted = true;
      } else {
        const after = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [PROBE_RECIPIENT] });
        transferSkimBps = shortfallBps(skimAmount, after > before ? after - before : 0n);
      }
    }

    return {
      ...base,
      sellRetried: true,
      partialAmount: tenth.toString(),
      partialSoldOk: partial?.ok ?? false,
      partialRevertReason: partial?.revertReason,
      partialReceived: partial?.received ?? "0",
      partialSellTxHash: partial?.hash ?? "0x",
      transferSkimBps, transferReverted, skimAmount: skimAmount.toString(), skimTxHash,
    };
  },
  interpret: interpretHoneypot,
};
