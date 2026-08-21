import { encodeFunctionData, parseAbi } from "viem";
import type { RawResult, ProbeCtx, Verdict, Hex, Probe } from "@sidik/shared";
import { buyBudget, buyExactEth, sellAll } from "../dex.js";
import { amount } from "../format.js";

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

// ponytail: distinct from testWallet, never needs to hold anything real — a
// fixed burn-ish EOA on the fork is enough to measure the transfer delta.
const RECIPIENT: Hex = "0x000000000000000000000000000000000000bEEF";

// getAmountsOut is exact constant-product arithmetic, so a genuine no-tax
// token lands within rounding of it. This floor only exists so dust never
// reads as a tax; anything above it is the contract keeping your money.
const MIN_REPORTABLE_TAX_BPS = 50;

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
  const txHashes = [raw.buyTxHash as Hex, raw.sellTxHash as Hex, raw.xferTxHash as Hex]
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
  const numbers = { sent, received, feePct, buyTaxPct, sellTaxPct };
  const xferRow = {
    label: "Transfer the full balance", claimed: "Recipient gets 100%",
    proven: taxedTransfer ? `Recipient got ${feePct} less` : "Recipient got 100%",
    ok: !taxedTransfer,
  };
  const rows = [buyRow, sellRow, xferRow];

  if (!taxedBuy && !taxedSell && !taxedTransfer) {
    return {
      probe: "hiddenFee", status: "PASS", title: "No hidden fee on buying, selling or transferring",
      rows, numbers, txHashes,
    };
  }

  const charged: string[] = [];
  if (taxedBuy) charged.push(`${buyTaxPct} on buy`);
  if (taxedSell) charged.push(`${sellTaxPct} on sell`);
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

    // Sell half and keep half: one buy funds both the sell measurement and
    // the transfer measurement, and both are needed — a token can tax the
    // pool route, the transfer, or either one alone.
    const half = bought / 2n;
    const sell = half > 0n ? await sellAll(fork, ctx, half) : undefined;
    const sellMeasured = Boolean(sell?.ok && BigInt(sell.predicted) > 0n);
    const sellTaxBps = sellMeasured ? shortfallBps(BigInt(sell!.predicted), BigInt(sell!.received)) : 0;
    const sellTxHash = (sell?.hash ?? "0x") as Hex;

    const sent = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [ctx.testWallet] });
    if (sent === 0n) {
      return { sent: "0", received: "0", buyTaxBps, sellTaxBps, sellMeasured,
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
        sellMeasured, feeBps: 0, buyTxHash: buy.hash, sellTxHash, xferTxHash: hash };
    }
    const after = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [RECIPIENT] });
    const received = after > before ? after - before : 0n;

    // Reflection tokens can credit MORE than was sent; that is not a fee, so
    // floor at 0 rather than reporting a negative one.
    const feeBps = shortfallBps(sent, received);
    return { sent: sent.toString(), received: received.toString(), buyTaxBps, sellTaxBps, sellMeasured,
      feeBps, buyTxHash: buy.hash, sellTxHash, xferTxHash: hash };
  },
  interpret: interpretHiddenFee,
};
