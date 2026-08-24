import { createPublicClient, http, encodeFunctionData, parseAbi } from "viem";
import { base } from "viem/chains";
import type { ForkClient, ProbeCtx, Hex } from "@sidik/shared";
import { isRevertError } from "./fork.js";
import { REVERT_MAX, untrustedText } from "./untrusted.js";
import { approveV3Data, quoteV3, swapV3Data, V3_ROUTER } from "./dexV3.js";

// Uniswap V2 on Base. V3 lives in dexV3.ts; pre-scan decides which venue a
// token actually trades on and everything here follows that decision.
// Router + Factory per Uniswap's official deployments doc
// (developers.uniswap.org/docs/protocols/v2/deployments), cross-checked
// against BaseScan's "Uniswap: V2 Router02" label.
const ROUTER: Hex = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";
const WETH: Hex = "0x4200000000000000000000000000000000000006";

const ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const DEADLINE = 9_999_999_999n; // fork-only, far future is fine

// How much ETH a probe spends to get a position to test with. A fixed size
// does not work: scam tokens — the ones worth probing — sit in pools smaller
// than a single ETH, and a trade that large either moves the price absurdly
// or trips the max-transaction limit taxing tokens like to impose. Either way
// the buy reverts and the probe reports "no liquidity to test" about a token
// that trades fine, which is a wrong answer, not a cautious one.
const MAX_BUY_ETH = 1n * 10n ** 18n;
const MIN_BUY_ETH = 10n ** 15n;         // 0.001 ETH — below this, dust rounding dominates
const POOL_FRACTION = 50n;              // spend ~2% of the pool

export async function buyBudget(fork: ForkClient, ctx: ProbeCtx): Promise<bigint> {
  const pool = ctx.scan.poolAddress;
  if (!pool) return MAX_BUY_ETH;
  try {
    const reserve = await fork.read<bigint>({
      address: WETH, abi: ERC20_ABI, functionName: "balanceOf", args: [pool],
    });
    const share = reserve / POOL_FRACTION;
    if (share >= MAX_BUY_ETH) return MAX_BUY_ETH;
    return share > MIN_BUY_ETH ? share : MIN_BUY_ETH;
  } catch {
    return MAX_BUY_ETH;
  }
}

// `predicted` is what the constant-product curve alone says the swap should
// deliver — the LP fee and price impact are already inside that number, so
// any gap between it and `amount` is the token skimming, nothing else. "0"
// means no quote was available, not "no shortfall".
export type DexResult = {
  ok: boolean;
  /** Tokens acquired on a buy, or tokens handed over on a sell. */
  amount: string;
  predicted: string;
  /** Sells only: WETH that actually left the pool. "0" on a buy. */
  received: string;
  hash: Hex;
  revertReason?: string;
};

async function balanceOf(fork: ForkClient, token: Hex, owner: Hex): Promise<bigint> {
  return fork.read<bigint>({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] });
}

export async function buyExactEth(fork: ForkClient, ctx: ProbeCtx, ethIn: bigint): Promise<DexResult> {
  const v3 = ctx.scan.venue === "v3";
  const predicted = await quote(fork, ctx, ethIn, [WETH, ctx.token]);
  const before = await balanceOf(fork, ctx.token, ctx.testWallet);
  const to = v3 ? V3_ROUTER : ROUTER;
  const data = v3
    // SwapRouter02 wraps msg.value itself when tokenIn is WETH.
    ? swapV3Data(WETH, ctx.token, ctx.scan.poolFee ?? 10000, ctx.testWallet, ethIn)
    : encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
        args: [0n, [WETH, ctx.token], ctx.testWallet, DEADLINE],
      });
  const { hash, reverted, revertReason } = await fork.send({ from: ctx.testWallet, to, data, value: ethIn });
  if (reverted) return { ok: false, amount: "0", predicted: predicted.toString(), received: "0", hash, revertReason };

  // Measure the delta, not amountsOut — fee-on-transfer tokens skim on the way in.
  const after = await balanceOf(fork, ctx.token, ctx.testWallet);
  const amount = after - before;
  if (amount <= 0n) return { ok: false, amount: "0", predicted: predicted.toString(), received: "0", hash };
  return { ok: true, amount: amount.toString(), predicted: predicted.toString(), received: "0", hash };
}

/** What the pool alone would deliver, with no token interference. */
async function quote(fork: ForkClient, ctx: ProbeCtx, amountIn: bigint, path: Hex[]): Promise<bigint> {
  if (ctx.scan.venue === "v3") {
    return quoteV3(fork, path[0]!, path[path.length - 1]!, amountIn, ctx.scan.poolFee ?? 10000);
  }
  try {
    const amounts = await fork.read<bigint[]>({
      address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [amountIn, path],
    });
    return amounts[amounts.length - 1] ?? 0n;
  } catch {
    // No route/pool to quote against. 0 disables the comparison rather than
    // pretending the swap under-delivered by 100%.
    return 0n;
  }
}

/**
 * Sells `amount` (default: the whole balance) and reports what came back.
 *
 * A sell that does not revert is not the same as a sell that pays you. The
 * proceeds are measured as the WETH that actually left the pool, against
 * getAmountsOut for the same trade — WETH on both sides of the comparison, so
 * gas never enters the number, and the curve's own fee and price impact are
 * already inside the prediction. Whatever is missing, the token kept.
 */
export async function sellAll(fork: ForkClient, ctx: ProbeCtx, sellAmount?: bigint): Promise<DexResult> {
  const amount = sellAmount ?? await balanceOf(fork, ctx.token, ctx.testWallet);
  const nothing = (extra: Partial<DexResult> = {}): DexResult =>
    ({ ok: false, amount: amount.toString(), predicted: "0", received: "0", hash: "0x" as Hex, ...extra });
  if (amount === 0n) return { ...nothing(), amount: "0", revertReason: "no tokens to sell" };

  const v3 = ctx.scan.venue === "v3";
  const router = v3 ? V3_ROUTER : ROUTER;
  const approveData = v3
    ? approveV3Data(amount)
    : encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [ROUTER, amount] });
  const approveTx = await fork.send({ from: ctx.testWallet, to: ctx.token, data: approveData });
  if (approveTx.reverted) {
    // Some honeypots block specifically at approve() (blacklist/ownership gates) —
    // that reason is exactly the evidence we want, so derive it the same way as a swap revert.
    const reason = approveTx.revertReason
      ?? await deriveRevertReason(fork, { account: ctx.testWallet, to: ctx.token, data: approveData });
    return nothing({ hash: approveTx.hash, revertReason: reason ?? "approve reverted" });
  }

  const pool = ctx.scan.poolAddress;
  // Without the pool address there is nothing to weigh the proceeds against,
  // and a measurement of zero must never read as "you were paid nothing" —
  // that turned USDC into a honeypot. No quote means callers do not judge.
  const predicted = pool ? await quote(fork, ctx, amount, [ctx.token, WETH]) : 0n;
  // V2's router unwraps to ETH, so the proceeds are read as the WETH that
  // left the pool. V3's router can pay in WETH directly, so the wallet's own
  // WETH delta is the measurement — exact either way, and neither touches
  // ETH balances, so gas never enters the number.
  const meter = v3 ? ctx.testWallet : pool;
  const wethBefore = meter ? await balanceOf(fork, WETH, meter) : 0n;

  const sellData = v3
    ? swapV3Data(ctx.token, WETH, ctx.scan.poolFee ?? 10000, ctx.testWallet, amount)
    : encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
        args: [amount, 0n, [ctx.token, WETH], ctx.testWallet, DEADLINE],
      });
  const sellTx = await fork.send({ from: ctx.testWallet, to: router, data: sellData });
  if (sellTx.reverted) {
    const revertReason = sellTx.revertReason
      ?? await deriveRevertReason(fork, { account: ctx.testWallet, to: router, data: sellData });
    return nothing({ hash: sellTx.hash, revertReason });
  }

  const wethAfter = meter ? await balanceOf(fork, WETH, meter) : 0n;
  const received = v3
    ? (wethAfter > wethBefore ? wethAfter - wethBefore : 0n)
    : (wethBefore > wethAfter ? wethBefore - wethAfter : 0n);
  return {
    ok: true, amount: amount.toString(), predicted: predicted.toString(),
    received: received.toString(), hash: sellTx.hash,
  };
}

// ponytail: fork.send() leaves revertReason undefined on a broadcast-then-
// revert (see engine/src/fork.ts). Replay the identical call as a read-only
// eth_call — post-revert state is unchanged, so it reproduces the same
// revert with its reason attached, without needing debug_traceTransaction.
async function deriveRevertReason(fork: ForkClient, args: { account: Hex; to: Hex; data: Hex }): Promise<string | undefined> {
  const pub = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });
  try {
    await pub.call(args);
    return undefined; // call succeeded on replay — no revert to report
  } catch (e: any) {
    // Only a genuine EVM revert is real evidence; an infra/RPC hiccup during
    // the replay must not be fabricated into a fake "revert reason" (same
    // distinction fork.ts's isRevertError makes for send()).
    if (!isRevertError(e)) return undefined;
    return untrustedText(e?.shortMessage ?? e?.message ?? e, REVERT_MAX);
  }
}
