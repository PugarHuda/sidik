import { encodeFunctionData, parseAbi, toFunctionSelector, type Abi, type Hex } from "viem";
import { selectorsIn } from "./selectors.js";

/**
 * How a contract that holds someone's LP might be made to give it back.
 *
 * When the largest position in a pool belongs to a contract, impersonating
 * that contract proves nothing: anvil bypasses its code, so "the pool can be
 * drained" would really mean "anvil can do anything". The honest question is
 * whether the contract's *owner* can get the liquidity out through the
 * contract's own front door — which is answerable the way ownerTrap answers
 * the same question about a token, by calling it and looking at what moved.
 *
 * The table is what is actually deployed, not what could exist. Every entry
 * was read off the bytecode of the 25 contracts holding launch positions in
 * this catalogue on 2026-08-31; the pool counts are theirs.
 *
 * Deliberately absent, though they appear on almost every one of those
 * contracts: `collect(...)` in its several shapes, `claimFees`,
 * `claimLiquidityFees`, `collectRewards`. Those pay out trading fees and
 * leave the position where it is, so operating them proves nothing about
 * whether the pool can be emptied — the same reason selectors.ts leaves
 * `removeLimits()` and `excludeFromFees()` out of the owner switches.
 *
 * Also absent: `transferFrom` and `safeTransferFrom`. They dominate a raw
 * scan of these contracts, but as PUSH4 constants for calls the contract
 * *makes* to the position manager rather than functions it exposes. A
 * selector in the bytecode is not the same as a function on the interface,
 * and calling one that is not there is a revert reported as a refusal.
 */
export interface ReleaseSwitch {
  sig: string;
  selector: Hex;
  /** Arguments that would hand the position, or the tokens under it, to `owner`. */
  args: (owner: Hex, positionId: bigint, token: Hex) => unknown[];
  abi: Abi;
}

const TABLE: { sig: string; args: ReleaseSwitch["args"] }[] = [
  // 26 pools, all on one launchpad's fee contract. Measured 2026-08-31: the
  // owner calling it reverts, so those pools keep an unanswered verdict and
  // now say that the front door was tried.
  { sig: "withdraw(uint256)", args: (_o, id) => [id] },
  // 6 pools. Takes a list of token addresses and a recipient.
  { sig: "release(address[],address)", args: (o, _id, t) => [[t], o] },
  // 4 pools: (token, recipient).
  { sig: "withdraw(address,address)", args: (o, _id, t) => [t, o] },
  // 3 pools each, on contracts with no owner() at all — kept because the
  // scan is per contract and a sibling deployment may well be Ownable.
  { sig: "withdrawERC20(address,address)", args: (o, _id, t) => [t, o] },
  { sig: "withdrawETH(address)", args: (o) => [o] },
  // The recognised locker's own exit. It is gated on a deadline the contract
  // enforces, so this is expected to revert before that date — which is the
  // proof that the lock holds, executed rather than assumed.
  { sig: "unlock(uint256)", args: (_o, id) => [id] },
  { sig: "transferLock(uint256,address)", args: (o, id) => [id, o] },
];

export const RELEASE_SWITCHES: ReleaseSwitch[] = TABLE.map((t) => ({
  ...t,
  selector: toFunctionSelector(`function ${t.sig}`),
  abi: parseAbi([`function ${t.sig}`] as [string]) as Abi,
}));

/** How many distinct ways out were searched for — quoted in the verdict. */
export const RELEASES_SEARCHED = RELEASE_SWITCHES.length;

/** The ways out this bytecode carries, in table order. */
export function releasesIn(code: string): ReleaseSwitch[] {
  const present = selectorsIn(code);
  return RELEASE_SWITCHES.filter((r) => present.has(r.selector));
}

export function releaseData(r: ReleaseSwitch, owner: Hex, positionId: bigint, token: Hex): Hex {
  return encodeFunctionData({ abi: r.abi, args: r.args(owner, positionId, token) });
}

/** `owner()`, the only ownership shape these holder contracts use. */
export const OWNABLE_ABI = parseAbi(["function owner() view returns (address)"]);
