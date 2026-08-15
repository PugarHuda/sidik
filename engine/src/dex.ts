import { createPublicClient, http, encodeFunctionData, parseAbi } from "viem";
import { base } from "viem/chains";
import type { ForkClient, ProbeCtx, Hex } from "@sidik/shared";

// ponytail: V2 only; Base liquidity is largely Aerodrome/Uniswap V3 — add
// adapters if RPC shows thin V2 coverage. Router + Factory per Uniswap's
// official deployments doc (developers.uniswap.org/docs/protocols/v2/deployments),
// cross-checked against BaseScan's "Uniswap: V2 Router02" label.
const ROUTER: Hex = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";
const WETH: Hex = "0x4200000000000000000000000000000000000006";

const ROUTER_ABI = parseAbi([
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const DEADLINE = 9_999_999_999n; // fork-only, far future is fine

export type DexResult = { ok: boolean; amount: string; hash: Hex; revertReason?: string };

async function balanceOf(fork: ForkClient, token: Hex, owner: Hex): Promise<bigint> {
  return fork.read<bigint>({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] });
}

export async function buyExactEth(fork: ForkClient, ctx: ProbeCtx, ethIn: bigint): Promise<DexResult> {
  const before = await balanceOf(fork, ctx.token, ctx.testWallet);
  const data = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
    args: [0n, [WETH, ctx.token], ctx.testWallet, DEADLINE],
  });
  const { hash, reverted, revertReason } = await fork.send({ from: ctx.testWallet, to: ROUTER, data, value: ethIn });
  if (reverted) return { ok: false, amount: "0", hash, revertReason };

  // Measure the delta, not amountsOut — fee-on-transfer tokens skim on the way in.
  const after = await balanceOf(fork, ctx.token, ctx.testWallet);
  const amount = after - before;
  if (amount <= 0n) return { ok: false, amount: "0", hash };
  return { ok: true, amount: amount.toString(), hash };
}

export async function sellAll(fork: ForkClient, ctx: ProbeCtx): Promise<DexResult> {
  const amount = await balanceOf(fork, ctx.token, ctx.testWallet);
  if (amount === 0n) return { ok: false, amount: "0", hash: "0x" as Hex, revertReason: "no tokens to sell" };

  const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [ROUTER, amount] });
  const approveTx = await fork.send({ from: ctx.testWallet, to: ctx.token, data: approveData });
  if (approveTx.reverted) {
    return { ok: false, amount: amount.toString(), hash: approveTx.hash, revertReason: approveTx.revertReason ?? "approve reverted" };
  }

  const sellData = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
    args: [amount, 0n, [ctx.token, WETH], ctx.testWallet, DEADLINE],
  });
  const sellTx = await fork.send({ from: ctx.testWallet, to: ROUTER, data: sellData });
  if (!sellTx.reverted) return { ok: true, amount: amount.toString(), hash: sellTx.hash };

  const revertReason = sellTx.revertReason
    ?? await deriveRevertReason(fork, { account: ctx.testWallet, to: ROUTER, data: sellData });
  return { ok: false, amount: amount.toString(), hash: sellTx.hash, revertReason };
}

// ponytail: fork.send() leaves revertReason undefined on a broadcast-then-
// revert (see engine/src/fork.ts). Replay the identical call as a read-only
// eth_call — post-revert state is unchanged, so it reproduces the same
// revert with its reason attached, without needing debug_traceTransaction.
async function deriveRevertReason(fork: ForkClient, args: { account: Hex; to: Hex; data: Hex }): Promise<string> {
  const pub = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });
  try {
    await pub.call(args);
    return "sell reverted (reason unavailable)";
  } catch (e: any) {
    return String(e?.shortMessage ?? e?.message ?? e).slice(0, 200);
  }
}
