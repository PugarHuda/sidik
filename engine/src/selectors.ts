import { encodeFunctionData, parseAbi, toFunctionSelector, type Abi, type Hex } from "viem";

/**
 * Which owner-only switches a contract actually carries, read off its
 * deployed bytecode rather than off an ABI somebody chose to publish.
 *
 * solc compiles a function dispatcher that compares the incoming selector
 * against a PUSH4 constant per external function, so the selectors are in the
 * bytecode of every contract whether or not its source was ever verified.
 * Checked against three verified Base tokens: every function in their
 * published ABI appeared in the PUSH4 scan, none missing.
 */
export function selectorsIn(code: string): Set<string> {
  const out = new Set<string>();
  if (!code || code.length < 4) return out;
  const bytes = Buffer.from(code.slice(2), "hex");
  for (let i = 0; i < bytes.length; i++) {
    const op = bytes[i]!;
    if (op === 0x63 && i + 4 < bytes.length) {
      out.add(("0x" + bytes.subarray(i + 1, i + 5).toString("hex")) as Hex);
      i += 4;
    } else if (op >= 0x60 && op <= 0x7f) {
      // Skip the rest of any other PUSHn payload. Without this, bytes inside
      // a PUSH32 constant get read as opcodes and invent selectors that the
      // contract does not have — the probe would then report calling a
      // function that was never there.
      i += op - 0x5f;
    }
  }
  return out;
}

/** What operating the switch is meant to do to a holder who already bought. */
type SwitchKind = "block" | "dilute";

export interface OwnerSwitch {
  /** Solidity signature, shown to the reader verbatim. */
  sig: string;
  selector: Hex;
  kind: SwitchKind;
  /** Arguments that make the switch hostile, given the wallet under test. */
  args: (victim: Hex, owner: Hex, totalSupply: bigint) => unknown[];
  /**
   * Fee setters only: the same call at descending values, tried in order
   * until one is accepted. Nearly every Base template caps fees
   * (`require(buy + sell <= 25)`), so a single try at 99 reverted, and "the
   * contract refused every call" became a PASS for an owner who can set a
   * 25% sell tax on demand. The percentage of the accepted rung is `feePct`.
   */
  ladder?: { args: unknown[]; feePct: number }[];
  abi: Abi;
}

/** Two-argument fee setters: (buy, sell) at descending caps. */
const TWO = [99, 49, 30, 25, 20, 15, 10].map((n) => ({ args: [BigInt(n), BigInt(n)], feePct: n }));
/** One-argument fee setters. */
const ONE = [99, 49, 30, 25, 20, 15, 10].map((n) => ({ args: [BigInt(n)], feePct: n }));
/** Three-argument (marketing, liquidity, dev) setters that sum to the fee. */
const THREE = [99, 49, 30, 25, 20, 15, 10].map((n) => {
  const a = BigInt(Math.floor(n / 3)), rest = BigInt(n) - 2n * a;
  return { args: [a, a, rest], feePct: n };
});

/**
 * The switches Sidik knows how to operate, with the arguments that turn each
 * one against a holder.
 *
 * Counts below are from the 194-token catalogue at the pinned block, so this
 * is not a list of theoretical dangers — it is what is on Base. Entries with
 * a zero count are the widely documented siblings of ones that do appear;
 * they cost a set lookup each and their absence is reported as searched-for.
 *
 * Deliberately excluded: removeLimits(), excludeFromFees(address,bool) and
 * setSwapTokensAtAmount(uint256), which are common but point the other way —
 * calling them helps a holder, so "the owner can call this" is not a finding.
 */
const TABLE: { sig: string; kind: SwitchKind; args: OwnerSwitch["args"]; ladder?: OwnerSwitch["ladder"] }[] = [
  // Stop the sell outright.
  { sig: "pause()", kind: "block", args: () => [] },                                        // 3 of 194
  { sig: "blacklist(address)", kind: "block", args: (v) => [v] },                            // 2
  { sig: "setBlacklist(address,bool)", kind: "block", args: (v) => [v, true] },              // 1
  { sig: "addToBlacklist(address)", kind: "block", args: (v) => [v] },                       // 1
  { sig: "addBots(address[])", kind: "block", args: (v) => [[v]] },                          // 5
  { sig: "setSwapEnabled(bool)", kind: "block", args: () => [false] },                       // 3
  { sig: "setTradingEnabled(bool)", kind: "block", args: () => [false] },                    // 0
  { sig: "setTrading(bool)", kind: "block", args: () => [false] },                           // 0
  { sig: "disableTrading()", kind: "block", args: () => [] },                                // 0
  { sig: "enableTrading(bool)", kind: "block", args: () => [false] },                        // template
  { sig: "setBots(address[],bool)", kind: "block", args: (v) => [[v], true] },               // template
  { sig: "blockBots(address[])", kind: "block", args: (v) => [[v]] },                        // template
  { sig: "setBlacklisted(address,bool)", kind: "block", args: (v) => [v, true] },            // template
  { sig: "manageBlacklist(address[],bool)", kind: "block", args: (v) => [[v], true] },       // template
  // Shrink the sell until it cannot go through.
  { sig: "updateMaxTxnAmount(uint256)", kind: "block", args: () => [1n] },                    // 2
  { sig: "updateMaxWalletAmount(uint256)", kind: "block", args: () => [1n] },                 // 2
  { sig: "setMaxTxAmount(uint256)", kind: "block", args: () => [1n] },                        // 0
  { sig: "setMaxWalletSize(uint256)", kind: "block", args: () => [1n] },                      // 0
  { sig: "setMaxTx(uint256)", kind: "block", args: () => [1n] },                              // template
  { sig: "setMaxWallet(uint256)", kind: "block", args: () => [1n] },                          // template
  { sig: "setMaxSell(uint256)", kind: "block", args: () => [1n] },                            // template
  // Take the proceeds instead of the tokens.
  { sig: "setFees(uint256,uint256)", kind: "block", args: () => [99n, 99n], ladder: TWO },    // 1
  { sig: "updateFees(uint256,uint256)", kind: "block", args: () => [99n, 99n], ladder: TWO }, // 1
  { sig: "setTaxes(uint256,uint256)", kind: "block", args: () => [99n, 99n], ladder: TWO },   // template
  { sig: "setSellTax(uint256)", kind: "block", args: () => [99n], ladder: ONE },              // 0
  { sig: "setBuyTax(uint256)", kind: "block", args: () => [99n], ladder: ONE },               // 0
  { sig: "setFee(uint256)", kind: "block", args: () => [99n], ladder: ONE },                  // 0
  { sig: "setTax(uint256)", kind: "block", args: () => [99n], ladder: ONE },                  // template
  { sig: "updateSellFees(uint256,uint256,uint256)", kind: "block", args: () => [33n, 33n, 33n], ladder: THREE }, // template
  { sig: "updateBuyFees(uint256,uint256,uint256)", kind: "block", args: () => [33n, 33n, 33n], ladder: THREE },  // template
  // Print supply and sell it into the same pool the holder must sell into.
  { sig: "mint(address,uint256)", kind: "dilute", args: (_v, owner, supply) => [owner, supply * 10n] }, // 18
];

export const OWNER_SWITCHES: OwnerSwitch[] = TABLE.map((t) => ({
  ...t,
  selector: toFunctionSelector(`function ${t.sig}`),
  // Parsed once at module load. The signatures are literals in the table
  // above, so a typo is a startup failure rather than a probe that silently
  // encodes the wrong call at run time.
  abi: parseAbi([`function ${t.sig}`] as [string]) as Abi,
}));

/** How many distinct switches were searched for — quoted in the verdict. */
export const SWITCHES_SEARCHED = OWNER_SWITCHES.length;

/** The switches this bytecode actually carries, in table order. */
export function switchesIn(code: string): OwnerSwitch[] {
  const present = selectorsIn(code);
  return OWNER_SWITCHES.filter((s) => present.has(s.selector));
}

export function callData(s: OwnerSwitch, victim: Hex, owner: Hex, totalSupply: bigint, args?: unknown[]): Hex {
  return encodeFunctionData({ abi: s.abi, args: args ?? s.args(victim, owner, totalSupply) });
}

/**
 * Selectors that mean "ownership can come back".
 *
 * The lock()/unlock() Ownable variant sets owner() to zero and keeps the
 * previous owner in storage; unlock() restores it after a timer. A token
 * carrying it reads as renounced to every scanner and to owner() itself.
 */
export const UNLOCK_SELECTOR: Hex = toFunctionSelector("function unlock()");

/**
 * Selectors that replace a proxy's code. OpenZeppelin ≤4 and ZeppelinOS
 * expose upgradeTo; OpenZeppelin 5's transparent proxy only upgradeToAndCall.
 */
export const UPGRADE_SELECTORS = {
  upgradeTo: toFunctionSelector("function upgradeTo(address)"),
  upgradeToAndCall: toFunctionSelector("function upgradeToAndCall(address,bytes)"),
} as const;
