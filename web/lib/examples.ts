import type { Hex } from "@sidik/shared";

// Client-side mirror of engine/src/examples.ts's EXAMPLES (label + address +
// kind only — BASE_FORK_BLOCK and friends are engine-internal).
export interface ExampleToken {
  label: string;
  address: Hex;
  kind: "safe" | "honeypot" | "highfee";
}

// ponytail: engine/src/examples.ts's honeypot/highfee placeholders are 38
// hex chars, not the required 40 — they'd fail engine's own TOKEN_RE too.
// Padded here to valid (still obviously-fake) 40-char addresses so the demo
// path actually validates; swap for real addresses alongside the engine ones.
export const EXAMPLES: ExampleToken[] = [
  { label: "USDC (Base)", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", kind: "safe" },
  { label: "Honeypot (example)", address: "0x000000000000000000000000000000000000dead", kind: "honeypot" },
  { label: "High-fee token (example)", address: "0x0000000000000000000000000000000000000fee", kind: "highfee" },
];
