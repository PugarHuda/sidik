import type { Hex } from "@sidik/shared";

// ponytail: recent Base mainnet block, hardcoded so demo runs are
// reproducible against a pinned fork. Pinned 2026-08-20 (~12h behind head at
// the time) so example-token liquidity is current; bump if a demo token was
// deployed after this block.
const DEFAULT_BASE_FORK_BLOCK = 50_200_000n;

export const BASE_FORK_BLOCK: bigint = process.env.BASE_FORK_BLOCK
  ? BigInt(process.env.BASE_FORK_BLOCK)
  : DEFAULT_BASE_FORK_BLOCK;

export interface ExampleToken {
  label: string;
  address: Hex;
  kind: "safe" | "honeypot" | "highfee";
}

export const EXAMPLES: ExampleToken[] = [
  // USDC on Base — canonical Circle-issued address, well-known bluechip.
  { label: "USDC (Base)", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", kind: "safe" },
  // Anastasia — a real Base honeypot, found by scanning Uniswap V2 PairCreated
  // events and executing a buy/sell on a fork of every liquid candidate.
  // Verified 2026-08-20 at block 50,200,000: ~7.05 WETH in the pool, buy
  // succeeds at both 1 ETH and 0.01 ETH, sell reverts both times with
  // "TransferHelper: TRANSFER_FROM_FAILED". Its owner() returns the zero
  // address, so it also *claims* renounced ownership — the exact
  // claimed-vs-proven gap Sidik exists to show.
  { label: "Anastasia (honeypot)", address: "0x48F617e5b1B214a90800348D7944bBc0E9290Fbb", kind: "honeypot" },
  // ponytail: placeholder — replace with a REAL known Base high-fee token
  // during the RPC batch (needs runtime confirmation of the fee behavior;
  // do not fabricate a real address here).
  { label: "Example high-fee token (placeholder)", address: "0x00000000000000000000000000000000000000fE", kind: "highfee" },
];
