import { encodeFunctionData, parseAbi } from "viem";
import type { RawResult, ProbeCtx, Verdict, Hex, Probe } from "@sidik/shared";
import { buyExactEth } from "../dex.js";

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

// ponytail: distinct from testWallet, never needs to hold anything real — a
// fixed burn-ish EOA on the fork is enough to measure the transfer delta.
const RECIPIENT: Hex = "0x000000000000000000000000000000000000bEEF";

export function interpretHiddenFee(raw: RawResult, _ctx: ProbeCtx): Verdict {
  const sent = String(raw.sent), received = String(raw.received);
  const txHashes = [raw.xferTxHash as Hex].filter((h) => h && h !== "0x") as Hex[];

  if (sent === "0") {
    return {
      probe: "hiddenFee", status: "NA", title: "Could not acquire tokens — no liquidity to test",
      rows: [{ label: "Transfer 100% of tokens", claimed: "Recipient gets 100%",
        proven: "No tokens acquired to test", ok: false }],
      numbers: { sent, received, feePct: "n/a" }, txHashes,
    };
  }

  if (raw.transferReverted) {
    return {
      probe: "hiddenFee", status: "FAIL", title: "Transfer reverted — the token cannot be moved",
      rows: [{ label: "Transfer 100% of tokens", claimed: "Recipient gets 100%",
        proven: "transfer() reverted; nothing moved", ok: false }],
      numbers: { sent, received, feePct: "n/a" }, txHashes,
    };
  }

  const bps = Number(raw.feeBps ?? 0);
  const pct = `${(bps / 100).toFixed(2).replace(/\.00$/, "")}%`;
  const ok = bps === 0;
  return {
    probe: "hiddenFee",
    status: ok ? "PASS" : "FAIL",
    title: ok ? "No hidden transfer fee" : `Hidden transfer fee of ${pct}`,
    rows: [{ label: "Transfer 100% of tokens", claimed: "Recipient gets 100%",
      proven: ok ? "Recipient got 100%" : `Recipient got ${pct} less`, ok }],
    numbers: { sent, received, feePct: pct }, txHashes,
  };
}

export const hiddenFeeProbe: Probe = {
  id: "hiddenFee", title: "Hidden transfer-fee test",
  applicableWhen: (s) => s.isErc20,
  async setup(fork, ctx) {
    await fork.setBalanceEth(ctx.testWallet, "10");
    await buyExactEth(fork, ctx, 1n * 10n ** 18n);
  },
  async execute(fork, ctx): Promise<RawResult> {
    const sent = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [ctx.testWallet] });
    if (sent === 0n) return { sent: "0", received: "0", feeBps: 0, xferTxHash: "0x" as Hex };

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
    if (reverted) return { sent: sent.toString(), received: "0", transferReverted: true, feeBps: 0, xferTxHash: hash };
    const after = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [RECIPIENT] });
    const received = after > before ? after - before : 0n;

    // Reflection tokens can credit MORE than was sent; that is not a fee, so
    // floor at 0 rather than reporting a negative one.
    const feeBps = received >= sent ? 0 : Number(((sent - received) * 10000n) / sent);
    return { sent: sent.toString(), received: received.toString(), feeBps, xferTxHash: hash };
  },
  interpret: interpretHiddenFee,
};
