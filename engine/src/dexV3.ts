import { createPublicClient, http, encodeFunctionData, parseAbi } from "viem";
import { base } from "viem/chains";
import type { ForkClient, Hex } from "@sidik/shared";

// Uniswap V3 on Base. Most of the Base tokens anyone has heard of left V2 for
// V3 — BRETT holds ~300 WETH here and under 0.2 on V2 — so probing only V2
// meant answering "N/A" about exactly the tokens a judge would type first.
export const V3_FACTORY: Hex = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const QUOTER: Hex = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";        // QuoterV2
const ROUTER: Hex = "0x2626664c2603336E57B271c5C0b26F421741e481";        // SwapRouter02
export const WETH: Hex = "0x4200000000000000000000000000000000000006";

// V3 splits a pair across fee tiers, so "the pool" is whichever tier actually
// holds the liquidity. All four are checked and the deepest one wins.
export const FEE_TIERS = [100, 500, 3000, 10000] as const;

const FACTORY_ABI = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const QUOTER_ABI = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
// SwapRouter02's params carry no deadline — that was SwapRouter01.
const ROUTER_ABI = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

export interface V3Pool {
  address: Hex;
  fee: number;
  weth: bigint;
}

/** The deepest WETH pool across V3's fee tiers, or undefined if there is none. */
export async function findV3Pool(
  read: <T>(a: { address: Hex; abi: unknown; functionName: string; args?: unknown[] }) => Promise<T>,
  token: Hex,
): Promise<V3Pool | undefined> {
  let best: V3Pool | undefined;
  for (const fee of FEE_TIERS) {
    try {
      const address = await read<Hex>({ address: V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [token, WETH, fee] });
      if (!address || /^0x0+$/.test(address)) continue;
      const weth = await read<bigint>({ address: WETH, abi: ERC20_ABI, functionName: "balanceOf", args: [address] });
      if (!best || weth > best.weth) best = { address, fee, weth };
    } catch { /* tier not deployed, or an unreadable pool — try the next */ }
  }
  return best;
}

// QuoterV2 is not a view function: it swaps and reverts to return the number,
// so it has to be eth_call'd rather than read. That is what the pool would
// deliver with no token interference, which is the baseline every tax
// measurement here compares against.
export async function quoteV3(fork: ForkClient, tokenIn: Hex, tokenOut: Hex, amountIn: bigint, fee: number): Promise<bigint> {
  if (amountIn === 0n) return 0n;
  const pub = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });
  try {
    const { result } = await pub.simulateContract({
      address: QUOTER, abi: QUOTER_ABI, functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
    });
    return (result as readonly bigint[])[0] ?? 0n;
  } catch {
    return 0n; // no quote means callers do not judge the shortfall
  }
}

/** Calldata for a V3 swap; ETH is wrapped by the router when tokenIn is WETH. */
export function swapV3Data(tokenIn: Hex, tokenOut: Hex, fee: number, recipient: Hex, amountIn: bigint): Hex {
  return encodeFunctionData({
    abi: ROUTER_ABI, functionName: "exactInputSingle",
    args: [{ tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
  });
}

export function approveV3Data(amount: bigint): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [ROUTER, amount] });
}

export const V3_ROUTER = ROUTER;
