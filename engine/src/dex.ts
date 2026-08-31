import { createPublicClient, encodeFunctionData, decodeEventLog, parseAbi, parseAbiItem } from "viem";
import { base } from "viem/chains";
import type { ForkClient, ProbeCtx, Hex } from "@sidik/shared";
import { FORK_GAS_LIMIT, isRevertError, forkTransport } from "./fork";
import { UNISWAP_V2, WETH } from "./base";
import { ERC20_ABI, V2_ROUTER_ABI } from "./abi";
import { REVERT_MAX, untrustedText } from "./untrusted";
import { approveV3Data, quoteV3, swapV3Data, V3_ROUTER } from "./dexV3";

const DEADLINE = 9_999_999_999n; // fork-only, far future is fine

// A sell that ran out of the fork's fixed 5M cap is retried once at anvil's
// block limit: reflection loops and swapBack-plus-addLiquidity can legitimately
// need more, and "out of gas" is not "you cannot sell".
const RETRY_GAS_LIMIT = 30_000_000n;

const V2_SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
);
const V2_PAIR_ABI = parseAbi(["function token0() view returns (address)"]);

/**
 * WETH the router's own swap paid out, read from the pool's Swap logs.
 *
 * The standard Base meme template sells its accumulated tax inside
 * _transfer when the destination is the pair — before the router's swap —
 * so one sell transaction drains the pool twice, and measuring the pool's
 * WETH delta credited the contract's cut to the holder. Four catalogue
 * tokens read "sell tax 0%" that way, one of them hand-verified at 2.99%.
 * The router's swap is the outermost call, so its Swap log is the last one
 * the pool emits in that transaction; that amount is what the holder got.
 */
export function wethOutOfSwapLogs(
  logs: { address: Hex; topics: Hex[]; data: Hex }[], pool: Hex, wethIsToken0: boolean,
): bigint | undefined {
  const swaps = logs.filter((l) => l.address.toLowerCase() === pool.toLowerCase());
  for (let i = swaps.length - 1; i >= 0; i--) {
    const l = swaps[i]!;
    try {
      const { eventName, args } = decodeEventLog({ abi: [V2_SWAP_EVENT], data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      if (eventName !== "Swap") continue;
      return wethIsToken0 ? args.amount0Out : args.amount1Out;
    } catch { /* not a Swap log — Sync, Transfer; keep looking */ }
  }
  return undefined;
}

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
  /** The transaction reverted, as opposed to going through and yielding nothing. */
  reverted?: boolean;
};

async function balanceOf(fork: ForkClient, token: Hex, owner: Hex): Promise<bigint> {
  return fork.read<bigint>({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] });
}

export async function buyExactEth(fork: ForkClient, ctx: ProbeCtx, ethIn: bigint): Promise<DexResult> {
  const v3 = ctx.scan.venue === "v3";
  const predicted = await quote(fork, ctx, ethIn, [WETH, ctx.token]);
  const before = await balanceOf(fork, ctx.token, ctx.testWallet);
  const to = v3 ? V3_ROUTER : UNISWAP_V2.router;
  const data = v3
    // SwapRouter02 wraps msg.value itself when tokenIn is WETH.
    ? swapV3Data(WETH, ctx.token, ctx.scan.poolFee ?? 10000, ctx.testWallet, ethIn)
    : encodeFunctionData({
        abi: V2_ROUTER_ABI,
        functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
        args: [0n, [WETH, ctx.token], ctx.testWallet, DEADLINE],
      });
  const buyTx = await fork.send({ from: ctx.testWallet, to, data, value: ethIn });
  if (buyTx.reverted) {
    // The reason is the finding: "trading not enabled", a max-tx cap, a
    // blacklist. It used to be dropped here and the probe said "no liquidity".
    const revertReason = buyTx.revertReason
      ?? await deriveRevertReason(fork, { account: ctx.testWallet, to, data, value: ethIn });
    return { ok: false, amount: "0", predicted: predicted.toString(), received: "0", hash: buyTx.hash, revertReason, reverted: true };
  }
  const { hash } = buyTx;

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
      address: UNISWAP_V2.router, abi: V2_ROUTER_ABI, functionName: "getAmountsOut", args: [amountIn, path],
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
  const router = v3 ? V3_ROUTER : UNISWAP_V2.router;
  const approveData = v3
    ? approveV3Data(amount)
    : encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [UNISWAP_V2.router, amount] });
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
        abi: V2_ROUTER_ABI,
        functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
        args: [amount, 0n, [ctx.token, WETH], ctx.testWallet, DEADLINE],
      });
  let sellTx = await fork.send({ from: ctx.testWallet, to: router, data: sellData });
  // Burned the whole cap: that is out-of-gas, not a refusal. Once more with
  // room, and only then judge.
  if (sellTx.reverted && sellTx.gasUsed === FORK_GAS_LIMIT) {
    const retry = await fork.send({ from: ctx.testWallet, to: router, data: sellData, gas: RETRY_GAS_LIMIT });
    sellTx = retry.reverted && retry.gasUsed === RETRY_GAS_LIMIT
      ? { ...retry, revertReason: `out of gas at ${RETRY_GAS_LIMIT.toLocaleString("en-US")}` }
      : retry;
  }
  if (sellTx.reverted) {
    const revertReason = sellTx.revertReason
      ?? await deriveRevertReason(fork, { account: ctx.testWallet, to: router, data: sellData });
    return nothing({ hash: sellTx.hash, revertReason });
  }

  let received: bigint;
  if (v3) {
    const wethAfter = await balanceOf(fork, WETH, ctx.testWallet);
    received = wethAfter > wethBefore ? wethAfter - wethBefore : 0n;
  } else {
    const fromLogs = pool && sellTx.logs ? await v2ProceedsFromLogs(fork, pool, sellTx.logs) : undefined;
    // The delta stays as the fallback for a pool that emitted no Swap log at
    // all (a non-standard pair); it is the measurement that over-credits.
    const wethAfter = meter ? await balanceOf(fork, WETH, meter) : 0n;
    received = fromLogs ?? (wethBefore > wethAfter ? wethBefore - wethAfter : 0n);
  }
  return {
    ok: true, amount: amount.toString(), predicted: predicted.toString(),
    received: received.toString(), hash: sellTx.hash,
  };
}

async function v2ProceedsFromLogs(fork: ForkClient, pool: Hex, logs: { address: Hex; topics: Hex[]; data: Hex }[]): Promise<bigint | undefined> {
  try {
    const token0 = await fork.read<Hex>({ address: pool, abi: V2_PAIR_ABI, functionName: "token0" });
    return wethOutOfSwapLogs(logs, pool, token0.toLowerCase() === WETH.toLowerCase());
  } catch {
    return undefined;
  }
}

// ponytail: fork.send() leaves revertReason undefined on a broadcast-then-
// revert (see engine/src/fork.ts). Replay the identical call as a read-only
// eth_call — post-revert state is unchanged, so it reproduces the same
// revert with its reason attached, without needing debug_traceTransaction.
async function deriveRevertReason(fork: ForkClient, args: { account: Hex; to: Hex; data: Hex; value?: bigint }): Promise<string | undefined> {
  const pub = createPublicClient({ chain: base, transport: forkTransport(fork.rpcUrl) });
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
