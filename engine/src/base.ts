import type { Hex } from "@sidik/shared";

/**
 * Every Base mainnet address the engine touches, in one place.
 *
 * These were previously redeclared in five files — WETH in dex, dexV3,
 * prescan, approvalDrain and lpRug — each with a comment apologising for the
 * copy. With two venues and five probes that stopped being a harmless
 * duplication: a wrong address in one copy would send a single probe to a
 * different contract and the verdict would still look plausible.
 *
 * Sources: Uniswap's official deployments doc
 * (developers.uniswap.org/contracts/v2/deployments and .../v3/deployments),
 * cross-checked against BaseScan's own contract labels.
 */
export const WETH: Hex = "0x4200000000000000000000000000000000000006";

export const UNISWAP_V2 = {
  router: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24" as Hex,
  factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6" as Hex,
} as const;

export const UNISWAP_V3 = {
  factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as Hex,
  quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as Hex,   // QuoterV2
  router: "0x2626664c2603336E57B271c5C0b26F421741e481" as Hex,   // SwapRouter02
  /**
   * V3 splits a pair across fee tiers, so "the pool" is whichever tier holds
   * the liquidity. All four are checked and the deepest wins.
   */
  feeTiers: [100, 500, 3000, 10000] as const,
} as const;

/**
 * Addresses whose holdings are beyond anyone's reach. Burned LP lands here,
 * which is what makes a pool unruggable — and it is also why they must never
 * be treated as a candidate to impersonate.
 */
export const BURN_ADDRESSES: Hex[] = [
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dEaD",
];

export const ZERO_ADDRESS: Hex = "0x0000000000000000000000000000000000000000";

/** anvil's first dev account: the only kind of sender it will sign for. */
export const ANVIL_ACCOUNT_0: Hex = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
