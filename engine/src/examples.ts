// ponytail: recent Base mainnet block, hardcoded so demo runs are
// reproducible against a pinned fork. Pinned 2026-08-20 (~12h behind head at
// the time) so example-token liquidity is current; bump if a demo token was
// deployed after this block.
const DEFAULT_BASE_FORK_BLOCK = 50_200_000n;

export const BASE_FORK_BLOCK: bigint = process.env.BASE_FORK_BLOCK
  ? BigInt(process.env.BASE_FORK_BLOCK)
  : DEFAULT_BASE_FORK_BLOCK;

// EXAMPLES lives in @sidik/shared — engine and web both need the same list,
// and keeping two copies in sync by hand already failed once.
export { EXAMPLES, type ExampleToken } from "@sidik/shared";
