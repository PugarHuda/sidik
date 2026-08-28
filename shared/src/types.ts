export type Hex = `0x${string}`;
export type ProbeStatus = "PASS" | "FAIL" | "NA";

export interface ClaimedVsProven {
  label: string;    // "Can sell after buying"
  claimed: string;  // "Yes — freely tradable"
  proven: string;   // "No — sell reverted"
  ok: boolean;      // green when true
}

export interface Verdict {
  probe: string;                    // probe id
  status: ProbeStatus;
  title: string;                    // one-line human verdict
  rows: ClaimedVsProven[];
  numbers: Record<string, string>;  // ALL figures, pre-formatted as strings
  txHashes: Hex[];                  // sandbox tx hashes
  reason?: string;                  // e.g. revert reason
  /**
   * False when the probe cannot say anything about THIS token because its
   * mechanism does not exist here — LP-rug against a Uniswap V3 pool, which
   * has no fungible LP token to pull. Distinct from an NA meaning "tried and
   * could not tell". Summaries must not let the first kind drag a token down.
   */
  applicable?: boolean;
}

export interface PreScan {
  token: Hex;
  isErc20: boolean;
  symbol: string;
  decimals: number;
  hasPool: boolean;
  poolAddress?: Hex;
  /** Which venue the pool lives on. Probes trade where the liquidity is. */
  venue?: "v2" | "v3";
  /** V3 only: the fee tier of the pool that was picked. */
  poolFee?: number;
  /** owner() if the contract exposes one. Nothing else is tried — see prescan.ts. */
  owner?: Hex;
  topHolders: { address: Hex; balance: string }[];
}

export interface ProbeCtx {
  token: Hex;
  scan: PreScan;
  testWallet: Hex;                  // funded EOA the probe trades from
  block: bigint;                    // pinned fork block
}

// Opaque per-probe payload produced by execute(), consumed by interpret().
export type RawResult = Record<string, unknown>;

// Thin wrapper over the viem clients bound to one ephemeral anvil.
export interface ForkClient {
  rpcUrl: string;
  impersonate(addr: Hex): Promise<void>;
  stopImpersonate(addr: Hex): Promise<void>;
  setBalanceEth(addr: Hex, eth: string): Promise<void>;
  read<T = unknown>(args: { address: Hex; abi: unknown; functionName: string; args?: unknown[] }): Promise<T>;
  // send from `from` (impersonated or funded); returns tx hash even if it reverts.
  send(args: { from: Hex; to: Hex; data?: Hex; value?: bigint }): Promise<{ hash: Hex; reverted: boolean; revertReason?: string }>;
  /**
   * Take a snapshot of the whole chain state.
   *
   * This is what lets one fork serve a whole run: each probe is given the same
   * pristine post-fork state, so isolation no longer costs a process. It is
   * also what makes the owner-trap probe's "the identical sell" a literal
   * claim rather than a figure of speech.
   */
  /**
   * Stop impersonating everything this fork was told to impersonate.
   *
   * Every probe stops its own, but only on the path where nothing went wrong.
   * That was harmless while each probe got its own anvil process and took its
   * leaks down with it; one fork now serves a whole run, and a snapshot
   * restores chain state rather than node settings, so nothing else undoes an
   * impersonation left behind by a probe that threw.
   */
  clearImpersonations(): Promise<void>;
  snapshot(): Promise<string>;
  /**
   * Roll state back to `id`.
   *
   * anvil CONSUMES the id: reverting to it invalidates it and every snapshot
   * taken after it, so a caller that wants to roll back twice must take a
   * fresh snapshot each time.
   */
  revertTo(id: string): Promise<void>;
}

export interface Probe {
  id: string;                       // stable id, also planner enum value
  title: string;                    // human name
  applicableWhen(scan: PreScan): boolean;
  setup(fork: ForkClient, ctx: ProbeCtx): Promise<void>;
  execute(fork: ForkClient, ctx: ProbeCtx): Promise<RawResult>;
  interpret(raw: RawResult, ctx: ProbeCtx): Verdict;   // PURE + deterministic
}
