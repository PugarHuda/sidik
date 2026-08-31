import { encodeFunctionData } from "viem";
import type { RawResult, ProbeCtx, Verdict, Hex, Probe } from "@sidik/shared";
import { buyBudget, buyExactEth, sellAll } from "../dex";
import { amount } from "../format";
import { ERC20_ABI } from "../abi";
import { PROBE_RECIPIENT } from "../base";

// ponytail: distinct from testWallet, never needs to hold anything real — a
// fixed burn-ish EOA on the fork is enough to measure the transfer delta.
const RECIPIENT: Hex = PROBE_RECIPIENT;

// getAmountsOut is exact constant-product arithmetic, so a genuine no-tax
// token lands within rounding of it. This floor only exists so dust never
// reads as a tax; anything above it is the contract keeping your money.
const MIN_REPORTABLE_TAX_BPS = 50;

// How far the chain is moved before the second sell. Launch taxes on Base
// templates are quoted in hours or "the first day"; one day clears them all.
const ONE_DAY_S = 86_400;

function pct(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.00$/, "")}%`;
}

/** Shortfall of `got` against what the curve alone said to expect. */
function shortfallBps(predicted: bigint, got: bigint): number {
  if (predicted <= 0n || got >= predicted) return 0;
  return Number(((predicted - got) * 10000n) / predicted);
}

export function interpretHiddenFee(raw: RawResult, ctx: ProbeCtx): Verdict {
  // Optional chaining because interpret is unit-tested with a bare ctx.
  const dec = ctx?.scan?.decimals ?? 18;
  const sym = ctx?.scan?.symbol || undefined;
  const rawSent = String(raw.sent);
  const sent = amount(rawSent, dec, sym);
  const received = amount(String(raw.received), dec, sym);
  const buyTaxBps = Number(raw.buyTaxBps ?? 0);
  const sellTaxBps = Number(raw.sellTaxBps ?? 0);
  const taxedBuy = buyTaxBps >= MIN_REPORTABLE_TAX_BPS;
  const taxedSell = sellTaxBps >= MIN_REPORTABLE_TAX_BPS;
  const buyTaxPct = buyTaxBps > 0 ? pct(buyTaxBps) : "0%";
  const sellTaxPct = raw.sellMeasured ? (sellTaxBps > 0 ? pct(sellTaxBps) : "0%") : "n/a";
  // The same sell a day later. A launch tax that decays ("30% for 24h") and
  // a tax that climbs are both findings a single sell seconds after the buy
  // cannot see; a stable tax is one number twice.
  const laterMeasured = raw.sellLaterMeasured === true;
  const sellTaxLaterBps = Number(raw.sellTaxLaterBps ?? 0);
  const sellTaxLaterPct = laterMeasured ? (sellTaxLaterBps > 0 ? pct(sellTaxLaterBps) : "0%") : "n/a";
  const taxChanges = laterMeasured && raw.sellMeasured
    && Math.abs(sellTaxLaterBps - sellTaxBps) >= MIN_REPORTABLE_TAX_BPS;
  const txHashes = [raw.buyTxHash as Hex, raw.sellTxHash as Hex, raw.sellLaterTxHash as Hex, raw.xferTxHash as Hex]
    .filter((h) => h && h !== "0x") as Hex[];

  if (rawSent === "0") {
    return {
      probe: "hiddenFee", status: "NA", title: "Could not acquire tokens — no liquidity to test",
      rows: [{ label: "Transfer the full balance", claimed: "Recipient gets 100%",
        proven: "No tokens acquired to test", ok: false }],
      numbers: { sent, received, feePct: "n/a", buyTaxPct: "n/a", sellTaxPct: "n/a" }, txHashes,
    };
  }

  // A tax charged on the way through the pool is the one a buyer actually
  // pays, and taxing tokens on Base deliberately leave wallet-to-wallet
  // transfers alone — so testing transfer() by itself hands them a PASS.
  const buyRow = {
    label: "Buy through the pool", claimed: "You receive the full quoted amount",
    proven: taxedBuy
      ? `Received ${buyTaxPct} less than the pool's own quote`
      : "Received the full quoted amount",
    ok: !taxedBuy,
  };
  // The sell side is charged separately and is routinely the larger of the
  // two. Reporting only the buy understates what a round trip costs.
  const sellRow = {
    label: "Sell back through the pool", claimed: "You receive the full quoted proceeds",
    proven: !raw.sellMeasured
      ? "Could not complete a test sell to measure"
      : taxedSell
        ? `Proceeds were ${sellTaxPct} short of the pool's own quote`
        : "Proceeds matched the quote",
    ok: raw.sellMeasured ? !taxedSell : false,
  };

  if (raw.transferReverted) {
    return {
      probe: "hiddenFee", status: "FAIL", title: "Transfer reverted — the token cannot be moved",
      rows: [buyRow, sellRow, { label: "Transfer the full balance", claimed: "Recipient gets 100%",
        proven: "transfer() reverted; nothing moved", ok: false }],
      numbers: { sent, received, feePct: "n/a", buyTaxPct, sellTaxPct }, txHashes,
    };
  }

  const bps = Number(raw.feeBps ?? 0);
  const feePct = pct(bps);
  const taxedTransfer = bps >= MIN_REPORTABLE_TAX_BPS;
  const numbers: Record<string, string> = { sent, received, feePct, buyTaxPct, sellTaxPct };
  if (laterMeasured) numbers.sellTaxLaterPct = sellTaxLaterPct;
  const xferRow = {
    label: "Transfer the full balance", claimed: "Recipient gets 100%",
    proven: taxedTransfer ? `Recipient got ${feePct} less` : "Recipient got 100%",
    ok: !taxedTransfer,
  };
  const rows = [buyRow, sellRow, xferRow];
  if (taxChanges) {
    rows.splice(2, 0, {
      label: "Sell back a day later", claimed: "The same tax as today",
      proven: `Proceeds were ${sellTaxLaterPct} short of the quote, against ${sellTaxPct} straight after buying`,
      ok: sellTaxLaterBps < MIN_REPORTABLE_TAX_BPS,
    });
  }
  const taxedLater = laterMeasured && sellTaxLaterBps >= MIN_REPORTABLE_TAX_BPS;

  if (!taxedBuy && !taxedSell && !taxedTransfer && !taxedLater) {
    // Only claim the sides that were actually measured. An unmeasured sell is
    // not a clean one, and saying otherwise put "no hidden fee on selling" on
    // the card for a honeypot whose sell reverts — the single worst place to
    // reassure anyone.
    return {
      probe: "hiddenFee", status: "PASS",
      title: raw.sellMeasured
        ? "No hidden fee on buying, selling or transferring"
        : "No hidden fee on buying or transferring — the sell could not be measured",
      rows, numbers, txHashes,
    };
  }

  const charged: string[] = [];
  if (taxedBuy) charged.push(`${buyTaxPct} on buy`);
  if (taxedSell || taxedLater) {
    charged.push(taxChanges ? `${sellTaxPct} on sell (${sellTaxLaterPct} a day later)` : `${sellTaxPct} on sell`);
  }
  if (taxedTransfer) charged.push(`${feePct} on transfer`);
  return {
    probe: "hiddenFee", status: "FAIL",
    title: `Hidden fees — ${charged.join(", ")}`,
    rows, numbers, txHashes,
  };
}

export const hiddenFeeProbe: Probe = {
  id: "hiddenFee", title: "Hidden fee test",
  applicableWhen: (s) => s.isErc20,
  async setup(fork, ctx) {
    await fork.setBalanceEth(ctx.testWallet, "10");
  },
  async execute(fork, ctx): Promise<RawResult> {
    // The buy happens here, not in setup, because its shortfall against the
    // pool's own quote is one of the three results this probe reports.
    const buy = await buyExactEth(fork, ctx, await buyBudget(fork, ctx));
    const bought = BigInt(buy.amount);
    const buyTaxBps = shortfallBps(BigInt(buy.predicted), bought);

    if (bought === 0n) {
      return { sent: "0", received: "0", buyTaxBps, sellTaxBps: 0, sellMeasured: false,
        feeBps: 0, buyTxHash: buy.hash, sellTxHash: "0x" as Hex, xferTxHash: "0x" as Hex };
    }

    // Sell a third now, a third a day later, and transfer the rest: one buy
    // funds all three measurements, and all three are needed — a token can
    // tax the pool route, the transfer, either one alone, or only for a
    // window after launch.
    const third = bought / 3n;
    const sell = third > 0n ? await sellAll(fork, ctx, third) : undefined;
    const sellMeasured = Boolean(sell?.ok && BigInt(sell.predicted) > 0n);
    const sellTaxBps = sellMeasured ? shortfallBps(BigInt(sell!.predicted), BigInt(sell!.received)) : 0;
    const sellTxHash = (sell?.hash ?? "0x") as Hex;

    let sellLater: Awaited<ReturnType<typeof sellAll>> | undefined;
    if (sellMeasured) {
      await fork.advance(ONE_DAY_S);
      sellLater = await sellAll(fork, ctx, third);
    }
    const sellLaterMeasured = Boolean(sellLater?.ok && BigInt(sellLater.predicted) > 0n);
    const sellTaxLaterBps = sellLaterMeasured ? shortfallBps(BigInt(sellLater!.predicted), BigInt(sellLater!.received)) : 0;
    const sellLaterTxHash = (sellLater?.hash ?? "0x") as Hex;
    const later = { sellLaterMeasured, sellTaxLaterBps, sellLaterTxHash };

    const sent = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [ctx.testWallet] });
    if (sent === 0n) {
      return { sent: "0", received: "0", buyTaxBps, sellTaxBps, sellMeasured, ...later,
        feeBps: 0, buyTxHash: buy.hash, sellTxHash, xferTxHash: "0x" as Hex };
    }

    // Measure the RECIPIENT's delta, not its absolute balance — the same
    // reason buyExactEth does. RECIPIENT is a real mainnet address that
    // already holds dust in plenty of tokens (USDC among them), and counting
    // that as "received" produced a negative fee and a false FAIL on a
    // bluechip.
    const before = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [RECIPIENT] });
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [RECIPIENT, sent] });
    const { hash, reverted } = await fork.send({ from: ctx.testWallet, to: ctx.token, data });
    // A reverted transfer moved nothing — reporting that as a "100% fee"
    // would be a fabricated number, so say what actually happened instead.
    if (reverted) {
      return { sent: sent.toString(), received: "0", transferReverted: true, buyTaxBps, sellTaxBps,
        sellMeasured, ...later, feeBps: 0, buyTxHash: buy.hash, sellTxHash, xferTxHash: hash };
    }
    const after = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [RECIPIENT] });
    const received = after > before ? after - before : 0n;

    // Reflection tokens can credit MORE than was sent; that is not a fee, so
    // floor at 0 rather than reporting a negative one.
    const feeBps = shortfallBps(sent, received);
    return { sent: sent.toString(), received: received.toString(), buyTaxBps, sellTaxBps, sellMeasured, ...later,
      feeBps, buyTxHash: buy.hash, sellTxHash, xferTxHash: hash };
  },
  interpret: interpretHiddenFee,
};
