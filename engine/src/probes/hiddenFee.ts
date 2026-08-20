import { encodeFunctionData, parseAbi } from "viem";
import type { RawResult, ProbeCtx, Verdict, Hex, Probe } from "@sidik/shared";
import { buyBudget, buyExactEth } from "../dex.js";

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

export function interpretHiddenFee(raw: RawResult, _ctx: ProbeCtx): Verdict {
  const sent = String(raw.sent), received = String(raw.received);
  const buyTaxBps = Number(raw.buyTaxBps ?? 0);
  const taxedBuy = buyTaxBps >= MIN_REPORTABLE_TAX_BPS;
  const buyTaxPct = buyTaxBps > 0 ? pct(buyTaxBps) : "0%";
  const txHashes = [raw.buyTxHash as Hex, raw.xferTxHash as Hex].filter((h) => h && h !== "0x") as Hex[];

  if (sent === "0") {
    return {
      probe: "hiddenFee", status: "NA", title: "Could not acquire tokens — no liquidity to test",
      rows: [{ label: "Transfer 100% of tokens", claimed: "Recipient gets 100%",
        proven: "No tokens acquired to test", ok: false }],
      numbers: { sent, received, feePct: "n/a", buyTaxPct: "n/a" }, txHashes,
    };
  }

  // A tax charged on the way through the pool is the one buyers actually
  // pay, and most taxing tokens deliberately leave wallet-to-wallet
  // transfers alone — so testing transfer() by itself hands them a PASS.
  const buyRow = {
    label: "Buy through the pool", claimed: "You receive the full quoted amount",
    proven: taxedBuy
      ? `Received ${buyTaxPct} less than the pool's own quote`
      : "Received the full quoted amount",
    ok: !taxedBuy,
  };

  if (raw.transferReverted) {
    return {
      probe: "hiddenFee", status: "FAIL", title: "Transfer reverted — the token cannot be moved",
      rows: [buyRow, { label: "Transfer 100% of tokens", claimed: "Recipient gets 100%",
        proven: "transfer() reverted; nothing moved", ok: false }],
      numbers: { sent, received, feePct: "n/a", buyTaxPct }, txHashes,
    };
  }

  const bps = Number(raw.feeBps ?? 0);
  const feePct = pct(bps);
  const taxedTransfer = bps >= MIN_REPORTABLE_TAX_BPS;
  const numbers = { sent, received, feePct, buyTaxPct };
  const xferRow = {
    label: "Transfer 100% of tokens", claimed: "Recipient gets 100%",
    proven: taxedTransfer ? `Recipient got ${feePct} less` : "Recipient got 100%",
    ok: !taxedTransfer,
  };
  const rows = [buyRow, xferRow];

  if (!taxedBuy && !taxedTransfer) {
    return {
      probe: "hiddenFee", status: "PASS", title: "No hidden fee on buying or transferring",
      rows, numbers, txHashes,
    };
  }

  const title = taxedBuy && taxedTransfer
    ? `Hidden fees — ${buyTaxPct} taken on buy, ${feePct} on transfer`
    : taxedBuy
      ? `Hidden buy tax of ${buyTaxPct}`
      : `Hidden transfer fee of ${feePct}`;
  return { probe: "hiddenFee", status: "FAIL", title, rows, numbers, txHashes };
}

export const hiddenFeeProbe: Probe = {
  id: "hiddenFee", title: "Hidden transfer-fee test",
  applicableWhen: (s) => s.isErc20,
  async setup(fork, ctx) {
    await fork.setBalanceEth(ctx.testWallet, "10");
  },
  async execute(fork, ctx): Promise<RawResult> {
    // The buy happens here, not in setup, because its shortfall against the
    // pool's own quote IS one of the two results this probe reports.
    const buy = await buyExactEth(fork, ctx, await buyBudget(fork, ctx));
    const predicted = BigInt(buy.predicted);
    const bought = BigInt(buy.amount);
    const buyTaxBps = predicted > 0n && bought < predicted
      ? Number(((predicted - bought) * 10000n) / predicted)
      : 0;

    const sent = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [ctx.testWallet] });
    if (sent === 0n) return { sent: "0", received: "0", buyTaxBps, feeBps: 0, buyTxHash: buy.hash, xferTxHash: "0x" as Hex };

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
    if (reverted) return { sent: sent.toString(), received: "0", transferReverted: true, buyTaxBps, feeBps: 0, buyTxHash: buy.hash, xferTxHash: hash };
    const after = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [RECIPIENT] });
    const received = after > before ? after - before : 0n;

    // Reflection tokens can credit MORE than was sent; that is not a fee, so
    // floor at 0 rather than reporting a negative one.
    const feeBps = received >= sent ? 0 : Number(((sent - received) * 10000n) / sent);
    return { sent: sent.toString(), received: received.toString(), buyTaxBps, feeBps, buyTxHash: buy.hash, xferTxHash: hash };
  },
  interpret: interpretHiddenFee,
};
