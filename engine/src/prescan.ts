import { createPublicClient, http, parseAbi, parseAbiItem } from "viem";
import { base } from "viem/chains";
import type { ForkClient, Hex, PreScan } from "@sidik/shared";
import { logsClient } from "./rpc.js";

// ponytail: duplicated from dex.ts (not exported there) rather than exporting
// it just for this module — same convention approvalDrain.ts already uses for
// ROUTER. Same Uniswap V2 factory/WETH the router probes trade against, so
// hasPool reflects where a probe will actually be able to buy/sell. Factory +
// WETH per Uniswap's official Base deployments doc, cross-checked against
// BaseScan's "Uniswap: V2 Factory" label.
const FACTORY: Hex = "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6";
const WETH: Hex = "0x4200000000000000000000000000000000000006";

const ZERO: Hex = (`0x${"0".repeat(40)}`) as Hex;

// balanceOf is probed with the wallet the probes will actually trade from,
// NOT the zero address. Plenty of real tokens revert on the zero address —
// PEPETO and LAYOOO both do — and probing there declared them "not an ERC-20"
// on the strength of a deliberate guard rather than anything about the token.
// Asking about the address that matters also makes a failure here meaningful.
const BALANCE_PROBE: Hex = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
]);
const FACTORY_ABI = parseAbi([
  "function getPair(address tokenA, address tokenB) view returns (address pair)",
]);
const OWNER_ABI = parseAbi(["function owner() view returns (address)"]);
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

// ponytail: same window as approvalDrain's APPROVAL_LOOKBACK_BLOCKS. ~1.7h of
// Base blocks — a recent-activity sample, not a true top-holders index. Served
// by the dedicated logs RPC (see rpc.ts), which handles this range fine.
// 9k blocks — the logs RPC caps a single eth_getLogs at 10k, so this takes
// the window right up to what one request allows. At 3k the holder sample
// came back empty for 56% of the catalogue, which is what starved lpRug's
// candidate search and left it saying NA more often than not.
const TOP_HOLDERS_LOOKBACK_BLOCKS = 9_000n;
const TOP_HOLDERS_SAMPLE_N = 10;

export async function prescan(fork: ForkClient, token: Hex): Promise<PreScan> {
  // ponytail: `any` here, not the full viem PublicClient<Base> generic — see
  // approvalDrain.ts's priceUsd for the same call.
  const pub: any = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });

  let symbol = "";
  let decimals = 18;
  try {
    symbol = await fork.read<string>({ address: token, abi: ERC20_ABI, functionName: "symbol" });
    decimals = Number(await fork.read<number>({ address: token, abi: ERC20_ABI, functionName: "decimals" }));
    await fork.read<bigint>({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [BALANCE_PROBE] });
  } catch {
    // Not an ERC-20 (or reads failed) — bail with sane defaults, no point
    // probing pool/owner/holders for a non-token.
    return { token, isErc20: false, symbol: "", decimals: 18, hasPool: false, topHolders: [] };
  }

  let hasPool = false;
  let poolAddress: Hex | undefined;
  try {
    const pair = await fork.read<Hex>({ address: FACTORY, abi: FACTORY_ABI, functionName: "getPair", args: [token, WETH] });
    if (pair && pair.toLowerCase() !== ZERO.toLowerCase()) {
      hasPool = true;
      poolAddress = pair;
    }
  } catch { /* factory read failed — treat as no pool */ }

  let owner: Hex | undefined;
  try {
    owner = await fork.read<Hex>({ address: token, abi: OWNER_ABI, functionName: "owner" });
  } catch { /* not Ownable / no owner() — leave undefined */ }

  const topHolders = await sampleTopHolders(fork, pub, token);

  return { token, isErc20: true, symbol, decimals, hasPool, poolAddress, owner, topHolders };
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
    candidates.delete(ZERO);

    const balances = await Promise.all(
      [...candidates].map(async (address) => ({
        address,
        balance: await fork.read<bigint>({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
      })),
    );

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
