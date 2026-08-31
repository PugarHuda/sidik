import { encodeFunctionData } from "viem";
import type { RawResult, ProbeCtx, Verdict, Hex, Probe, ForkClient } from "@sidik/shared";
import { buyBudget, buyExactEth, sellAll, type DexResult } from "../dex";
import { amount } from "../format";
import { ERC20_ABI } from "../abi";
import { PROBE_RECIPIENT, WETH } from "../base";

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
// transfers — and, from the wallet it lands in, whether anyone but the buyer
// is allowed to sell. Enough to be above dust rounding, small enough not to
// matter.
const SKIM_PROBE_DIVISOR = 100n;

// When the buy itself reverts, these smaller sizes are tried before the pool
// is called empty. A max-tx cap or a "trading not enabled" gate rejects the
// first size and says nothing about liquidity.
const BUY_RETRY_DIVISORS = [10n, 100n] as const;

// A sell that reverts at once is tried again after each of these. The
// commonest "anti-bot" clause on Base is a per-wallet cooldown of minutes;
// a launch window is hours. A sell that works after either is a cooldown,
// which costs a holder patience, not their money.
const COOLDOWNS: { label: string; seconds: number }[] = [
  { label: "1h", seconds: 3_600 },
  { label: "24h", seconds: 86_400 },
];

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
  const txHashes = [
    raw.buyTxHash, raw.sellTxHash, raw.partialSellTxHash, raw.cooldownSellTxHash,
    raw.skimTxHash, raw.transfereeSellTxHash,
  ].filter((h) => h && h !== "0x") as Hex[];

  if (rawBought === "0") {
    const poolWeth = BigInt(String(raw.poolWeth ?? "0"));
    const buyReverted = raw.buyReverted === true;
    // The pool holds WETH and every size of buy reverted: that is the
    // contract saying no, not an empty pool. "Trading not enabled", a max-tx
    // below a 0.02%-of-pool buy, a buy-side blacklist — all findings that
    // used to be filed as "no liquidity to test".
    if (buyReverted && poolWeth > 0n) {
      const reason = String(raw.buyRevertReason ?? "buy reverted");
      const attempts = String(raw.buyAttempts ?? "1");
      return {
        probe: "honeypot", status: "FAIL",
        title: `Pool holds ${amount(poolWeth, 18, "WETH")} but the buy reverted (${reason})`,
        rows: [{ label: "Buy the token", claimed: "Tradable",
          proven: `Every buy reverted, down to ${attempts === "1" ? "the first size" : `a hundredth of the first size`} (${reason})`, ok: false }],
        numbers: { boughtAmount: bought, poolWeth: amount(poolWeth, 18, "WETH"), buyAttempts: attempts },
        txHashes, reason,
      };
    }
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

  // The wallet the buyer handed 1% to. A buyer-whitelist honeypot lets the
  // wallet that bought through the router sell, and blocks everyone it
  // transferred to — the buyer's own sell passing is exactly what it wants
  // you to see.
  const transfereeTried = raw.transfereeSellTried === true;
  const transfereeOk = raw.transfereeSoldOk === true;
  const transfereeRow = transfereeTried
    ? {
        label: "Sell from a wallet that received a transfer", claimed: "Anyone holding it can sell",
        proven: transfereeOk
          ? (raw.transfereeSoldAfter ? `Sold, but only after ${String(raw.transfereeSoldAfter)}` : "Sold")
          : raw.transferReverted
            ? "The transfer itself reverted, so nothing arrived to sell"
            : `Sell reverted (${String(raw.transfereeRevertReason ?? "sell reverted")}), including after 24h`,
        ok: transfereeOk,
      }
    : undefined;

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

    // Neither size sold at once; the whole position sold after the chain
    // moved on. That is a cooldown. It costs a holder time, and a holder
    // who bought into a dump pays for that time — but the exit exists.
    const cooldown = raw.cooldownSoldAfter ? String(raw.cooldownSoldAfter) : undefined;
    if (cooldown) {
      return {
        probe: "honeypot", status: "PASS",
        title: `Not a honeypot — a cooldown: the sell reverted at once and went through after ${cooldown}`,
        rows: [{ label: "Sell after buying", claimed: "Freely tradable",
          proven: `Selling straight after the buy reverted (${fullReason}); the identical sell ${cooldown} later went through`, ok: true }],
        numbers: {
          boughtAmount: bought, cooldownSell: `succeeded after ${cooldown}`,
          cooldownProceeds: amount(String(raw.cooldownReceived ?? "0"), 18, "WETH"),
        },
        txHashes,
        reason: fullReason,
      };
    }

    const numbers: Record<string, string> = { boughtAmount: bought };
    if (retried) {
      numbers.partialSell = "reverted";
      numbers.transferSkim = raw.transferReverted ? "transfer reverted" : skimPct;
      if (raw.cooldownTried) numbers.cooldownSell = "reverted after 24h";
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
          ? `Selling everything reverted, and so did selling a tenth of it (${String(raw.partialRevertReason ?? fullReason)})${raw.cooldownTried ? ", and again 24h later" : ""}`
          : "Sell reverted",
        ok: false }],
      numbers, txHashes,
      reason: fullReason,
    };
  }

  const sellRow = { label: "Sell after buying", claimed: "Freely tradable", proven: "Sell succeeded", ok: true };
  if (transfereeRow && !transfereeOk && !raw.transferReverted) {
    return {
      probe: "honeypot", status: "FAIL",
      title: "Honeypot — the buyer can sell, a wallet it transferred to cannot",
      rows: [sellRow, transfereeRow],
      numbers: { boughtAmount: bought, transfereeSell: "reverted" },
      txHashes,
      reason: String(raw.transfereeRevertReason ?? "sell reverted"),
    };
  }
  return {
    probe: "honeypot", status: "PASS", title: "Not a honeypot — buy and sell both succeed",
    rows: transfereeRow ? [sellRow, transfereeRow] : [sellRow],
    numbers: transfereeRow
      ? { boughtAmount: bought, transfereeSell: transfereeOk ? "succeeded" : "transfer reverted" }
      : { boughtAmount: bought },
    txHashes,
  };
}

/**
 * The same sell, tried again after the chain has moved on.
 *
 * Snapshot first and roll back after: the point is to know whether time
 * alone unlocks the sell, and the state the rest of the probe runs against
 * must not carry the extra day.
 */
async function sellAfterCooldown(fork: ForkClient, ctx: ProbeCtx, sellAmount?: bigint): Promise<{ after?: string; result?: DexResult }> {
  const snap = await fork.snapshot();
  try {
    let elapsed = 0;
    for (const c of COOLDOWNS) {
      await fork.advance(c.seconds - elapsed);
      elapsed = c.seconds;
      const result = await sellAll(fork, ctx, sellAmount);
      if (result.ok) return { after: c.label, result };
      if (c === COOLDOWNS[COOLDOWNS.length - 1]) return { result };
    }
    return {};
  } finally {
    await fork.revertTo(snap);
  }
}

export const honeypotProbe: Probe = {
  id: "honeypot",
  title: "Honeypot sell test",
  applicableWhen: (s) => s.isErc20 && s.hasPool,
  async setup(fork, ctx) {
    await fork.setBalanceEth(ctx.testWallet, "10");
  },
  async execute(fork, ctx): Promise<RawResult> {
    const budget = await buyBudget(fork, ctx);
    let buy = await buyExactEth(fork, ctx, budget);
    let buyAttempts = 1;
    // A reverted buy is retried smaller before the pool is called empty: a
    // max-tx cap rejects 2% of the pool and accepts 0.02% of it.
    for (const d of BUY_RETRY_DIVISORS) {
      // Only a revert is retried: a buy that went through and yielded no
      // tokens is a different fact, and a smaller one will not yield more.
      if (!buy.reverted) break;
      const smaller = budget / d;
      if (smaller === 0n) break;
      buy = await buyExactEth(fork, ctx, smaller);
      buyAttempts++;
    }
    if (!buy.ok || buy.amount === "0") {
      const pool = ctx.scan.poolAddress;
      const poolWeth = pool
        ? await fork.read<bigint>({ address: WETH, abi: ERC20_ABI, functionName: "balanceOf", args: [pool] }).catch(() => 0n)
        : 0n;
      return {
        boughtAmount: "0", soldOk: false, buyTxHash: buy.hash, sellTxHash: "0x" as Hex,
        buyReverted: buy.reverted === true, buyRevertReason: buy.revertReason,
        buyAttempts: String(buyAttempts), poolWeth: poolWeth.toString(),
      };
    }
    const bought = BigInt(buy.amount);

    // Before the buyer sells: hand 1% to a second wallet and let it sell.
    // Two facts from one transfer — whether the token skims a plain
    // transfer, and whether anyone but the buyer is allowed out. Done first
    // because the buyer's own sell empties the position.
    let transferSkimBps = 0;
    let transferReverted = false;
    let skimTxHash: Hex = "0x" as Hex;
    let transferee: RawResult = {};
    const skimAmount = bought / SKIM_PROBE_DIVISOR;
    if (skimAmount > 0n) {
      const before = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [PROBE_RECIPIENT] });
      const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [PROBE_RECIPIENT, skimAmount] });
      const tx = await fork.send({ from: ctx.testWallet, to: ctx.token, data });
      skimTxHash = tx.hash;
      if (tx.reverted) {
        transferReverted = true;
        transferee = { transfereeSellTried: true, transfereeSoldOk: false };
      } else {
        const after = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [PROBE_RECIPIENT] });
        const arrived = after > before ? after - before : 0n;
        transferSkimBps = shortfallBps(skimAmount, arrived);
        if (arrived > 0n) {
          await fork.impersonate(PROBE_RECIPIENT);
          await fork.setBalanceEth(PROBE_RECIPIENT, "1");
          const asRecipient: ProbeCtx = { ...ctx, testWallet: PROBE_RECIPIENT };
          let sell = await sellAll(fork, asRecipient, arrived);
          let soldAfter: string | undefined;
          if (!sell.ok) {
            const later = await sellAfterCooldown(fork, asRecipient, arrived);
            if (later.result?.ok) { sell = later.result; soldAfter = later.after; }
          }
          await fork.stopImpersonate(PROBE_RECIPIENT);
          transferee = {
            transfereeSellTried: true, transfereeSoldOk: sell.ok, transfereeSoldAfter: soldAfter,
            transfereeRevertReason: sell.revertReason, transfereeSellTxHash: sell.hash,
          };
        }
      }
    }
    const skim = { transferSkimBps, transferReverted, skimAmount: skimAmount.toString(), skimTxHash, ...transferee };

    const sell = await sellAll(fork, ctx);
    const base = {
      boughtAmount: buy.amount, soldOk: sell.ok, sellRevertReason: sell.revertReason,
      sellPredicted: sell.predicted, sellReceived: sell.received,
      buyTxHash: buy.hash, sellTxHash: sell.hash, ...skim,
    };
    if (sell.ok) return base;

    // The whole position would not sell. Two more things are worth knowing
    // before that is called a honeypot, and both are found by executing.
    //
    // One: is it a cap rather than a block? A tenth of the position is tried.
    // The first sell reverted, so the state it ran against is unchanged and
    // this is the same question at a smaller size, not a second attempt after
    // something moved.
    const remaining = bought - (transferReverted ? 0n : skimAmount);
    const tenth = remaining / PARTIAL_SELL_DIVISOR;
    const partial = tenth > 0n ? await sellAll(fork, ctx, tenth) : undefined;

    // Two: is it a cooldown rather than a block? The identical sell, after
    // an hour and after a day. Nothing else has changed when it runs.
    const cooldown = partial?.ok ? {} : await sellAfterCooldown(fork, ctx);

    return {
      ...base,
      sellRetried: true,
      partialAmount: tenth.toString(),
      partialSoldOk: partial?.ok ?? false,
      partialRevertReason: partial?.revertReason,
      partialReceived: partial?.received ?? "0",
      partialSellTxHash: partial?.hash ?? "0x",
      cooldownTried: !partial?.ok,
      cooldownSoldAfter: cooldown.after,
      cooldownReceived: cooldown.result?.received ?? "0",
      cooldownSellTxHash: cooldown.result?.hash ?? "0x",
    };
  },
  interpret: interpretHoneypot,
};
