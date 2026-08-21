import type { Hex } from "./types";

export interface ExampleToken {
  label: string;
  address: Hex;
  kind: "safe" | "honeypot" | "highfee" | "wallet";
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
  // BRB — a real Base token that taxes the pool route while leaving
  // wallet-to-wallet transfers alone. Verified 2026-08-20 at block
  // 50,200,000: 2.99% taken on both buy and sell, reproducible across trade
  // sizes, while transfer() delivers 100%. It is the demo case for why
  // testing transfer() by itself is not enough — that test hands this token a
  // clean PASS. (0xB357E2546e51fa6f2383e768A7d022d5777Ba152 is a second,
  // identically-taxed token if this one's pool moves.) Its LP is 99.98%
  // burned, so it is also the one example where all three probes return a
  // definite verdict rather than an NA.
  { label: "BRB (3% buy tax)", address: "0x0e86eFe5Ba52336c2173AD69EE726e054619e0d8", kind: "highfee" },
  // A real Base wallet carrying a live token approval. Paste a wallet rather
  // than a token and Sidik probes the approval instead: it impersonates the
  // approved spender on the fork and calls transferFrom. Verified 2026-08-21
  // at block 50,200,000 — the drain lands, moving 0.677 WETH worth of tokens
  // the owner still holds. Nothing happens to the real wallet; the whole
  // thing lives and dies inside the fork.
  { label: "Wallet with a live approval", address: "0x89f48b0067F42F3a8b233a6dc9DcD4101AA0EA1C", kind: "wallet" },
];
