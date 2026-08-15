import type { Hex } from "@sidik/shared";

// ponytail: recent Base mainnet block, hardcoded so demo runs are
// reproducible against a pinned fork. Exact pin gets finalized in the RPC batch.
const DEFAULT_BASE_FORK_BLOCK = 24_000_000n;

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
  // ponytail: placeholder — replace with a REAL known Base honeypot token
  // during the RPC batch (needs runtime confirmation that the token
  // actually exhibits honeypot behavior; do not fabricate a real address here).
  { label: "Example honeypot (placeholder)", address: "0x0000000000000000000000000000000000dEaD", kind: "honeypot" },
  // ponytail: placeholder — replace with a REAL known Base high-fee token
  // during the RPC batch (needs runtime confirmation of the fee behavior;
  // do not fabricate a real address here).
  { label: "Example high-fee token (placeholder)", address: "0x000000000000000000000000000000000000fE", kind: "highfee" },
];
