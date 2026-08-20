import type { Hex } from "./types";

export interface ExampleToken {
  label: string;
  address: Hex;
  kind: "safe" | "honeypot" | "highfee";
}

// Lives in shared because engine and web must agree on it: web renders these
// as the demo's one-click buttons and engine probes whatever address arrives.
// They were two hand-kept copies and drifted — web still pointed at
// placeholder addresses after engine got real ones.
export const EXAMPLES: ExampleToken[] = [
  // USDC on Base — canonical Circle-issued address, well-known bluechip.
  // Verified PASS on a real fork at BASE_FORK_BLOCK, 2026-08-20.
  { label: "USDC (Base)", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", kind: "safe" },
  // Anastasia — a real Base honeypot, found by scanning Uniswap V2
  // PairCreated events and executing a buy/sell on a fork of every liquid
  // candidate. Verified 2026-08-20 at block 50,200,000: ~7.05 WETH in the
  // pool, buy succeeds at both 1 ETH and 0.01 ETH, sell reverts both times
  // with "TransferHelper: TRANSFER_FROM_FAILED". Its owner() returns the
  // zero address, so it also *claims* renounced ownership — the exact
  // claimed-vs-proven gap Sidik exists to show.
  { label: "Anastasia (honeypot)", address: "0x48F617e5b1B214a90800348D7944bBc0E9290Fbb", kind: "honeypot" },
];
