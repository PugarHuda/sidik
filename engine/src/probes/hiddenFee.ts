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
  const bps = Number(raw.feeBps ?? 0);
  const pct = `${(bps / 100).toFixed(2).replace(/\.00$/, "")}%`;
  const ok = bps === 0;
  return {
    probe: "hiddenFee",
    status: bps === 0 ? "PASS" : "FAIL",
    title: ok ? "No hidden transfer fee" : `Hidden transfer fee of ${pct}`,
    rows: [{ label: "Transfer 100% of tokens", claimed: "Recipient gets 100%",
      proven: ok ? "Recipient got 100%" : `Recipient got ${pct} less`, ok }],
    numbers: { sent, received, feePct: pct }, txHashes: [raw.xferTxHash as Hex].filter(Boolean) as Hex[],
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

    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [RECIPIENT, sent] });
    const { hash } = await fork.send({ from: ctx.testWallet, to: ctx.token, data });
    const received = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [RECIPIENT] });

    const feeBps = sent > 0n ? Number(((sent - received) * 10000n) / sent) : 0;
    return { sent: sent.toString(), received: received.toString(), feeBps, xferTxHash: hash };
  },
  interpret: interpretHiddenFee,
};
