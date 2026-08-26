import { parseAbi, parseAbiItem } from "viem";

/**
 * Shared ABI fragments.
 *
 * ERC20_ABI existed six times over, each a different partial subset —
 * balanceOf+approve here, symbol+decimals+balanceOf there — so adding a call
 * to a probe meant editing that probe's private copy and nothing else knew.
 * One superset costs nothing at runtime: viem encodes by the function it is
 * asked for, not by everything in the array.
 */
export const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
]);

/** Ownable-ish. Absent on plenty of real tokens, so every read is optional. */
export const OWNER_ABI = parseAbi(["function owner() view returns (address)"]);

export const V2_ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)",
]);

export const V2_FACTORY_ABI = parseAbi([
  "function getPair(address tokenA, address tokenB) view returns (address pair)",
  "function allPairsLength() view returns (uint256)",
]);

export const V2_PAIR_ABI = parseAbi([
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function token0() view returns (address)",
]);

export const V3_FACTORY_ABI = parseAbi([
  "function getPool(address,address,uint24) view returns (address)",
]);

// QuoterV2 is not a view function: it performs the swap and reverts to return
// the number, so it has to be eth_call'd rather than read.
export const V3_QUOTER_ABI = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

// SwapRouter02's params carry no deadline — that was SwapRouter01.
export const V3_ROUTER_ABI = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

export const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
export const APPROVAL_EVENT = parseAbiItem(
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
);
export const PAIR_CREATED_EVENT = parseAbiItem(
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256 allPairs)",
);
export const POOL_CREATED_EVENT = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
);
