import { createPublicClient, getAddress } from "viem";
import { base } from "viem/chains";
import { forkTransport } from "./fork";
import type { ForkClient, Hex, PreScan } from "@sidik/shared";
import { logsClient } from "./rpc";
import { findV3Pool } from "./dexV3";
import { ANVIL_ACCOUNT_0, UNISWAP_V2, WETH, ZERO_ADDRESS } from "./base";
import { ERC20_ABI, OWNER_ABI, TRANSFER_EVENT, V2_FACTORY_ABI } from "./abi";
import { SYMBOL_MAX, untrustedText } from "./untrusted";
import { mapLimit } from "./pool";
import { log } from "./log";

// balanceOf is probed with the wallet the probes will actually trade from,
// NOT the zero address. Plenty of real tokens revert on the zero address —
// PEPETO and LAYOOO both do — and probing there declared them "not an ERC-20"
// on the strength of a deliberate guard rather than anything about the token.
// Asking about the address that matters also makes a failure here meaningful.
const BALANCE_PROBE: Hex = ANVIL_ACCOUNT_0;

// ponytail: same window as approvalDrain's APPROVAL_LOOKBACK_BLOCKS. Base
// mines every 2 seconds, so 9,000 blocks is five hours — a recent-activity
// sample, not a true top-holders index. (The "~1.7h" this used to say was
// left over from the 3,000-block window, and survived the change sitting two
// lines above the number that contradicted it.)
//
// 9k and not more: the logs RPC caps a single eth_getLogs at 10k, so this
// takes the window right up to what one request allows. At 3k the holder
// sample came back empty for 56% of the catalogue, which is what starved
// lpRug's candidate search and left it saying NA more often than not.
const TOP_HOLDERS_LOOKBACK_BLOCKS = 9_000n;
const TOP_HOLDERS_SAMPLE_N = 10;

// Every candidate costs one balanceOf, and the window names far more of them
// than the ten that survive: BRETT alone yields 388 unique addresses over
// 9,000 blocks. Reading those in one tick is a 388-deep burst against a
// single anvil, and the same burst upstream is what starts the 429s that get
// reported as findings about the token. Eight at a time keeps the sample
// intact and the fork responsive.
const HOLDER_READ_CONCURRENCY = 8;

export async function prescan(fork: ForkClient, token: Hex): Promise<PreScan> {
  // ponytail: `any` here, not the full viem PublicClient<Base> generic — see
  // approvalDrain.ts's priceUsd for the same call.
  const pub: any = createPublicClient({ chain: base, transport: forkTransport(fork.rpcUrl) });

  let symbol = "";
  let decimals = 18;
  try {
    symbol = untrustedText(await fork.read<string>({ address: token, abi: ERC20_ABI, functionName: "symbol" }), SYMBOL_MAX);
    decimals = Number(await fork.read<number>({ address: token, abi: ERC20_ABI, functionName: "decimals" }));
    await fork.read<bigint>({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [BALANCE_PROBE] });
  } catch {
    // Not an ERC-20 (or reads failed) — bail with sane defaults, no point
    // probing pool/owner/holders for a non-token.
    return { token, isErc20: false, symbol: "", decimals: 18, hasPool: false, topHolders: [] };
  }

  // Both venues are measured and the deeper one wins. Picking V2 just because
  // a pair exists would probe an abandoned pool: BRETT keeps under 0.2 WETH on
  // V2 and about 300 on V3, and trading against the empty one says nothing
  // about the token.
  let hasPool = false;
  let poolAddress: Hex | undefined;
  let venue: "v2" | "v3" | undefined;
  let poolFee: number | undefined;

  let v2Weth = 0n;
  // Both lookups log when they fail. A refused factory read used to be
  // indistinguishable from "no pool", and "no pool" is what every probe then
  // reports as the finding.
  try {
    const pair = await fork.read<Hex>({ address: UNISWAP_V2.factory, abi: V2_FACTORY_ABI, functionName: "getPair", args: [token, WETH] });
    if (pair && pair.toLowerCase() !== ZERO_ADDRESS) {
      v2Weth = await fork.read<bigint>({ address: WETH, abi: ERC20_ABI, functionName: "balanceOf", args: [pair] });
      hasPool = true;
      poolAddress = pair;
      venue = "v2";
    }
  } catch (e) {
    log.error({ event: "prescan.v2LookupFailed", token, reason: e instanceof Error ? e.message : String(e) });
  }

  try {
    const v3 = await findV3Pool((a) => fork.read(a), token);
    if (v3 && v3.weth > v2Weth) {
      hasPool = true;
      poolAddress = v3.address;
      venue = "v3";
      poolFee = v3.fee;
    }
  } catch (e) {
    log.error({ event: "prescan.v3LookupFailed", token, reason: e instanceof Error ? e.message : String(e) });
  }

  // Only asked when Uniswap has nothing: the answer is a reason, not a venue
  // to trade on.
  const otherVenues = hasPool ? undefined : await otherVenuesOf(token);

  // owner() only, and that was checked rather than assumed. The owner-switch
  // probe reads this to decide who to impersonate, so a missed owner would
  // hand a token a PASS it did not earn. Every address in the catalogue was
  // scanned for getOwner(), admin(), getAdmin(), authority(), governance() and
  // operator(): not one exposes any of them. The tokens with no owner here
  // genuinely have no owner function, which the probe reports as NA rather
  // than as safety.
  let owner: Hex | undefined;
  try {
    owner = await fork.read<Hex>({ address: token, abi: OWNER_ABI, functionName: "owner" });
  } catch { /* not Ownable / no owner() — leave undefined */ }

  const proxy = await proxyOf(pub, token);
  const topHolders = await sampleTopHolders(fork, pub, token);

  return {
    token, isErc20: true, symbol, decimals, hasPool, poolAddress, venue, poolFee, owner,
    ...proxy, ...(otherVenues?.length ? { otherVenues } : {}),
    topHolders,
  };
}

/**
 * The storage slots a proxy keeps its implementation and admin in.
 *
 * EIP-1967: keccak256("eip1967.proxy.implementation") - 1 and the admin and
 * beacon siblings. ZeppelinOS (Circle's FiatTokenProxy, still what USDC runs
 * on) predates the standard and uses keccak256("org.zeppelinos.proxy.*").
 */
const SLOT = {
  impl1967: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  admin1967: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  beacon1967: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  implZos: "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
  adminZos: "0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b",
} as const;

const BEACON_ABI = [{ type: "function", name: "implementation", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;

function slotAddress(word: Hex | undefined): Hex | undefined {
  if (!word || word.length !== 66) return undefined;
  const tail = word.slice(-40);
  if (/^0+$/.test(tail)) return undefined;
  return getAddress(`0x${tail}`);
}

/**
 * Whether the token is a proxy, and if so whose code runs and who can swap it.
 *
 * Nine recorded addresses are proxies (USDC, cbBTC, cbETH, USDbC among them).
 * The owner-switch probe scans bytecode for the switches it can operate, and a
 * proxy's bytecode is a delegatecall stub — so every one of them read as "no
 * owner switch found" while the code that actually runs carries pause(),
 * blacklist(address) and mint(address,uint256).
 */
async function proxyOf(pub: any, token: Hex): Promise<Pick<PreScan, "implementation" | "proxyAdmin" | "proxyKind">> {
  try {
    const at = (slot: string) => pub.getStorageAt({ address: token, slot }) as Promise<Hex | undefined>;
    const [impl, admin, beacon, implZos, adminZos] = await Promise.all([
      at(SLOT.impl1967), at(SLOT.admin1967), at(SLOT.beacon1967), at(SLOT.implZos), at(SLOT.adminZos),
    ]);
    const implementation = slotAddress(impl);
    if (implementation) return { implementation, proxyAdmin: slotAddress(admin), proxyKind: "eip1967" };
    const beaconAddr = slotAddress(beacon);
    if (beaconAddr) {
      const viaBeacon = await pub.readContract({ address: beaconAddr, abi: BEACON_ABI, functionName: "implementation" }) as Hex;
      return { implementation: viaBeacon, proxyAdmin: slotAddress(admin), proxyKind: "beacon" };
    }
    const zos = slotAddress(implZos);
    if (zos) return { implementation: zos, proxyAdmin: slotAddress(adminZos), proxyKind: "zos" };
    return {};
  } catch (e) {
    // Reported, never swallowed: a missed proxy is a missed switch scan.
    log.error({ event: "prescan.proxyLookupFailed", token, reason: e instanceof Error ? e.message : String(e) });
    return {};
  }
}

// DEX Screener's public endpoint, no key, 60 requests a minute. Only the
// venue name, the pair and the dollar depth are kept — enough to say where
// the liquidity is, nothing that would be quoted as a measurement.
const DEXSCREENER = "https://api.dexscreener.com/token-pairs/v1/base/";
const OTHER_VENUES_TIMEOUT_MS = 4_000;

export function parseOtherVenues(body: unknown): NonNullable<PreScan["otherVenues"]> {
  if (!Array.isArray(body)) return [];
  const out: NonNullable<PreScan["otherVenues"]> = [];
  for (const p of body as Record<string, unknown>[]) {
    const dex = typeof p.dexId === "string" ? p.dexId : "";
    const pair = typeof p.pairAddress === "string" && /^0x[0-9a-fA-F]{40}$/.test(p.pairAddress) ? (p.pairAddress as Hex) : undefined;
    const liq = (p.liquidity as { usd?: unknown } | undefined)?.usd;
    const liquidityUsd = typeof liq === "number" && Number.isFinite(liq) ? Math.round(liq) : 0;
    if (!dex || !pair) continue;
    // Uniswap pairs here would mean our own lookup missed them; report them
    // too, so the reason is complete rather than flattering.
    out.push({ dex, pair, liquidityUsd });
  }
  return out.sort((a, b) => b.liquidityUsd - a.liquidityUsd).slice(0, 5);
}

async function otherVenuesOf(token: Hex): Promise<PreScan["otherVenues"]> {
  try {
    const res = await fetch(`${DEXSCREENER}${token}`, { signal: AbortSignal.timeout(OTHER_VENUES_TIMEOUT_MS) });
    if (!res.ok) {
      log.error({ event: "prescan.otherVenuesFailed", token, reason: `HTTP ${res.status}` });
      return undefined;
    }
    return parseOtherVenues(await res.json());
  } catch (e) {
    log.error({ event: "prescan.otherVenuesFailed", token, reason: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}

// ponytail: sampled from recent Transfer logs over a bounded window, not a
// true top-holders index — refine in the RPC batch.
async function sampleTopHolders(fork: ForkClient, pub: any, token: Hex): Promise<PreScan["topHolders"]> {
  try {
    // Window ends at the fork's pinned head so the sample matches the state
    // balanceOf is read against; the logs themselves come off-fork (see rpc.ts).
    const head = await pub.getBlockNumber();
    const fromBlock = head > TOP_HOLDERS_LOOKBACK_BLOCKS ? head - TOP_HOLDERS_LOOKBACK_BLOCKS : 0n;
    const logs = await logsClient().getLogs({ address: token, event: TRANSFER_EVENT, fromBlock, toBlock: head });

    const candidates = new Set<Hex>();
    for (const log of logs) {
      const { from, to } = log.args as { from?: Hex; to?: Hex };
      if (from) candidates.add(from);
      if (to) candidates.add(to);
    }
    candidates.delete(ZERO_ADDRESS);

    const addresses = [...candidates];
    const settled = await mapLimit(addresses, HOLDER_READ_CONCURRENCY, (address) =>
      fork.read<bigint>({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }));

    // Settled, not all-or-nothing: a token that reverts balanceOf for one
    // address used to cost the entire sample, which then starved lpRug's
    // candidate search and made it answer NA about a pool it could have tested.
    const balances = settled.flatMap((r, i) => {
      const address = addresses[i];
      return r.status === "fulfilled" && address ? [{ address, balance: r.value }] : [];
    });

    return balances
      .filter((b) => b.balance > 0n)
      .sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0))
      .slice(0, TOP_HOLDERS_SAMPLE_N)
      .map((b) => ({ address: b.address, balance: b.balance.toString() }));
  } catch (e) {
    // An empty sample is a valid result -- a token nobody moved in the window
    // genuinely has no recent holders. A FAILED sample is not the same thing,
    // and this returned the same empty array for both, silently.
    //
    // lpRug values the position it rugs through this sample, so a refused
    // getLogs made it report "no holder position to measure the pull against"
    // about a pool whose LP owner it had already identified and could have
    // pulled. Logged at error level for the same reason probe.failed is: from
    // the outside, an infrastructure failure and a finding look identical.
    log.error({
      event: "prescan.holderSampleFailed", token,
      reason: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}
