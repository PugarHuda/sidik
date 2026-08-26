import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import type { ForkClient, Hex, PreScan } from "@sidik/shared";
import { logsClient } from "./rpc.js";
import { findV3Pool } from "./dexV3.js";
import { ANVIL_ACCOUNT_0, UNISWAP_V2, WETH, ZERO_ADDRESS } from "./base.js";
import { ERC20_ABI, OWNER_ABI, TRANSFER_EVENT, V2_FACTORY_ABI } from "./abi.js";
import { SYMBOL_MAX, untrustedText } from "./untrusted.js";
import { mapLimit } from "./pool.js";

// balanceOf is probed with the wallet the probes will actually trade from,
// NOT the zero address. Plenty of real tokens revert on the zero address —
// PEPETO and LAYOOO both do — and probing there declared them "not an ERC-20"
// on the strength of a deliberate guard rather than anything about the token.
// Asking about the address that matters also makes a failure here meaningful.
const BALANCE_PROBE: Hex = ANVIL_ACCOUNT_0;

// ponytail: same window as approvalDrain's APPROVAL_LOOKBACK_BLOCKS. ~1.7h of
// Base blocks — a recent-activity sample, not a true top-holders index. Served
// by the dedicated logs RPC (see rpc.ts), which handles this range fine.
// 9k blocks — the logs RPC caps a single eth_getLogs at 10k, so this takes
// the window right up to what one request allows. At 3k the holder sample
// came back empty for 56% of the catalogue, which is what starved lpRug's
// candidate search and left it saying NA more often than not.
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
  const pub: any = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });

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
  try {
    const pair = await fork.read<Hex>({ address: UNISWAP_V2.factory, abi: V2_FACTORY_ABI, functionName: "getPair", args: [token, WETH] });
    if (pair && pair.toLowerCase() !== ZERO_ADDRESS) {
      v2Weth = await fork.read<bigint>({ address: WETH, abi: ERC20_ABI, functionName: "balanceOf", args: [pair] });
      hasPool = true;
      poolAddress = pair;
      venue = "v2";
    }
  } catch { /* factory read failed — treat as no V2 pool */ }

  try {
    const v3 = await findV3Pool((a) => fork.read(a), token);
    if (v3 && v3.weth > v2Weth) {
      hasPool = true;
      poolAddress = v3.address;
      venue = "v3";
      poolFee = v3.fee;
    }
  } catch { /* no V3 pool — keep whatever V2 gave us */ }

  let owner: Hex | undefined;
  try {
    owner = await fork.read<Hex>({ address: token, abi: OWNER_ABI, functionName: "owner" });
  } catch { /* not Ownable / no owner() — leave undefined */ }

  const topHolders = await sampleTopHolders(fork, pub, token);

  return { token, isErc20: true, symbol, decimals, hasPool, poolAddress, venue, poolFee, owner, topHolders };
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
  } catch {
    // No logs / provider hiccup — an empty sample is a valid (if thin) result.
    return [];
  }
}
