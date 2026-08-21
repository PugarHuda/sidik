import { encodeFunctionData, parseAbi, parseAbiItem, formatEther } from "viem";
import type { RawResult, ProbeCtx, Verdict, Hex, Probe, ForkClient } from "@sidik/shared";
import { logsClient } from "../rpc.js";

// ponytail: duplicated from dex.ts (not exported there) rather than exporting
// it just for this probe — same Uniswap V2 router already used elsewhere.
const ROUTER: Hex = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";
const WETH: Hex = "0x4200000000000000000000000000000000000006";

const ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const DEADLINE = 9_999_999_999n; // fork-only, far future is fine

// Display value for "no LP-owner candidate found". It is NOT how the absence
// is signalled — raw.lpHolderFound carries that, because the zero address is
// also a legitimate LP holder (burned LP lands there) and overloading it
// turned "we found nobody" into a PASS meaning "the LP is burned".
const NO_LP_OWNER: Hex = "0x0000000000000000000000000000000000000000" as Hex;

// Below this share, the largest LP holder the pre-scan could find is not the
// party capable of rugging the pool — so pulling their LP proves nothing
// either way. A PASS there would be a verdict with no evidence behind it.
const MIN_TESTABLE_LP_PCT = 1;

// LP sitting at a burn address can never be pulled by anyone, so a pool whose
// LP is almost entirely burned has no single-owner rug path — and that takes
// two balance reads to prove, with no holder discovery at all. Not 100%:
// Uniswap V2 permanently locks MINIMUM_LIQUIDITY at the zero address, and
// projects routinely leave a dust remainder behind.
const BURNED_LP_PCT_FOR_PASS = 99;

// Addresses whose LP is beyond everyone's reach. They are not rug candidates,
// so they must never be picked as "the LP owner" and impersonated.
const BURN_ADDRESSES: Hex[] = [
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dEaD",
];

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const LP_TRANSFER_LOOKBACK_BLOCKS = 3_000n;

export function interpretLpRug(raw: RawResult, _ctx: ProbeCtx): Verdict {
  const ownerLpPct = Number(raw.ownerLpPct ?? 0);
  const lpOwner = String(raw.lpOwner ?? "0x0") as Hex;
  const before = String(raw.holderValueBefore ?? "0");
  const after = String(raw.holderValueAfter ?? "0");
  const pct = `${Math.round(ownerLpPct)}%`;
  const burnedPct = Number(raw.burnedLpPct ?? 0);
  const burned = `${burnedPct.toFixed(2).replace(/[.]00$/, "")}%`;
  const txHashes = [raw.pullTxHash as Hex].filter((h) => h && h !== "0x") as Hex[];
  const numbers = { ownerLpPct: pct, burnedLpPct: burned, holderValueBefore: before, holderValueAfter: after, lpOwner };

  // "Collapsed" = after is a small fraction of before (rug drained the pool).
  const beforeN = Number(before) || 0;
  const afterN = Number(after) || 0;
  const collapsed = beforeN > 0 && afterN <= beforeN * 0.5;

  // Burned LP is unreachable by definition, so this is a positive proof of
  // safety rather than an absence of evidence — and it needs no holder
  // discovery to establish.
  if (burnedPct >= BURNED_LP_PCT_FOR_PASS) {
    return {
      probe: "lpRug", status: "PASS", title: `LP is burned — ${burned} of it cannot be withdrawn by anyone`,
      rows: [{ label: "LP owner can drain the pool", claimed: "Liquidity is locked/safe",
        proven: `${burned} of LP supply sits at a burn address, beyond any owner's reach`, ok: true }],
      numbers, txHashes,
    };
  }

  // ponytail: LP-holder discovery is a bounded candidate scan (token owner,
  // sampled token holders, recent LP movements), so it genuinely misses the
  // controller sometimes. Both the public and the free-tier RPC cap
  // eth_getLogs at 10k blocks, so a full-history LP index would cost dozens
  // of paginated requests per run — too slow for a live demo. Report what is
  // actually known instead of guessing: "not burned, holder unknown" is a
  // useful answer, and a different one from "LP is safe".
  if (!raw.lpHolderFound || ownerLpPct < MIN_TESTABLE_LP_PCT) {
    return {
      probe: "lpRug", status: "NA",
      title: `LP is not burned (${burned}) and its holder could not be identified`,
      rows: [{ label: "LP owner can drain the pool", claimed: "Liquidity is locked/safe",
        proven: raw.lpHolderFound
          ? `Only ${burned} of LP is burned; the largest holder found controls just ${pct}, too little to test a rug`
          : `Only ${burned} of LP is burned, so someone can still withdraw it — but no holder could be identified`, ok: false }],
      numbers, txHashes,
    };
  }

  // Without a priced holder position there is nothing to measure the pull
  // against, so "the pool survived" would be an assertion, not a measurement.
  if (beforeN === 0) {
    return {
      probe: "lpRug", status: "NA", title: "No holder position to measure the pull against",
      rows: [{ label: "LP owner can drain the pool", claimed: "Liquidity is locked/safe",
        proven: "Could not price any holder's position before the pull", ok: false }],
      numbers, txHashes,
    };
  }

  if (collapsed) {
    return {
      probe: "lpRug", status: "FAIL", title: "LP rug possible — owner can pull all liquidity",
      rows: [{ label: "LP owner can drain the pool", claimed: "Liquidity is locked/safe",
        proven: `Owner holds ${pct} of LP and removing it collapsed a holder's position from ${before} to ${after}`, ok: false }],
      numbers, txHashes,
    };
  }

  return {
    probe: "lpRug", status: "PASS", title: "LP is locked/burned — no single-owner rug path",
    rows: [{ label: "LP owner can drain the pool", claimed: "Liquidity is locked/safe",
      proven: `Largest LP holder found controls only ${pct} of supply`, ok: true }],
    numbers, txHashes,
  };
}

export const lpRugProbe: Probe = {
  id: "lpRug",
  title: "LP-rug probe",
  applicableWhen: (s) => s.isErc20 && s.hasPool,
  async setup() { /* the LP owner is discovered during execute, and funded for gas there */ },
  async execute(fork: ForkClient, ctx: ProbeCtx): Promise<RawResult> {
    const pool = ctx.scan.poolAddress;
    const nothingFound = (burnedLpPct = 0) => ({
      lpOwner: NO_LP_OWNER, lpHolderFound: false, ownerLpPct: 0, burnedLpPct,
      holderValueBefore: "0", holderValueAfter: "0", pullTxHash: "0x" as Hex,
    });
    if (!pool) return nothingFound();

    const totalSupply = await fork.read<bigint>({ address: pool, abi: ERC20_ABI, functionName: "totalSupply" });
    if (totalSupply === 0n) return nothingFound();

    let burnedLp = 0n;
    for (const addr of BURN_ADDRESSES) {
      burnedLp += await fork.read<bigint>({ address: pool, abi: ERC20_ABI, functionName: "balanceOf", args: [addr] });
    }
    const burnedLpPct = Number((burnedLp * 10000n) / totalSupply) / 100;

    // Candidates: whoever the token names as owner, whoever recently held the
    // token, and whoever recently moved the LP token itself. Burn addresses
    // are excluded — their LP is unreachable, so impersonating one would
    // prove nothing about whether this pool can be rugged.
    const unreachable = new Set(BURN_ADDRESSES.map((a) => a.toLowerCase()));
    const candidates = [
      ctx.scan.owner,
      ...ctx.scan.topHolders.map((h) => h.address),
      ...(await recentLpMovers(pool, ctx.block)),
    ].filter((a): a is Hex => Boolean(a) && !unreachable.has(String(a).toLowerCase()));

    let lpOwner: Hex = NO_LP_OWNER;
    let lpBalance = 0n;
    for (const candidate of new Set(candidates)) {
      const bal = await fork.read<bigint>({ address: pool, abi: ERC20_ABI, functionName: "balanceOf", args: [candidate] });
      if (bal > lpBalance) { lpBalance = bal; lpOwner = candidate; }
    }

    const sampleHolder = ctx.scan.topHolders[0]?.address;
    const priceHolder = async (): Promise<string> => {
      if (!sampleHolder) return "0";
      const bal = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [sampleHolder] });
      if (bal === 0n) return "0";
      try {
        const amounts = await fork.read<bigint[]>({
          address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [bal, [ctx.token, WETH]],
        });
        return formatEther(amounts[1]);
      } catch {
        return "0"; // ponytail: no route left (e.g. pool already drained) — value is 0
      }
    };

    const holderValueBefore = await priceHolder();

    if (lpBalance === 0n) {
      return { ...nothingFound(burnedLpPct), holderValueBefore, holderValueAfter: holderValueBefore };
    }

    const ownerLpPct = Math.round(Number((lpBalance * 10000n) / totalSupply) / 100);

    await fork.impersonate(lpOwner);
    // Impersonation gets you the sender, not their gas. A real LP owner who
    // wanted to rug would have ETH; on a fork we hand it to them so the probe
    // measures whether the pool CAN be drained rather than whether this
    // particular account happens to hold gas money. Seven tokens in the
    // catalogue failed outright on "total cost exceeds the balance" before
    // this, and the failure looked like a finding.
    await fork.setBalanceEth(lpOwner, "1");
    const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [ROUTER, lpBalance] });
    const approveTx = await fork.send({ from: lpOwner, to: pool, data: approveData });

    let pullTxHash: Hex = approveTx.hash;
    let holderValueAfter = holderValueBefore;
    if (!approveTx.reverted) {
      const removeData = encodeFunctionData({
        abi: ROUTER_ABI, functionName: "removeLiquidity",
        args: [ctx.token, WETH, lpBalance, 0n, 0n, lpOwner, DEADLINE],
      });
      const removeTx = await fork.send({ from: lpOwner, to: ROUTER, data: removeData });
      pullTxHash = removeTx.hash;
      if (!removeTx.reverted) holderValueAfter = await priceHolder();
    }
    await fork.stopImpersonate(lpOwner);

    return { lpOwner, lpHolderFound: true, ownerLpPct, burnedLpPct, holderValueBefore, holderValueAfter, pullTxHash };
  },
  interpret: interpretLpRug,
};

// One bounded log query for addresses that recently sent or received the LP
// token — the pair's own Transfer events, read off-fork through the logs RPC.
// Catches an LP holder who is actively moving liquidity; silent on a pair
// that has been still for longer than the window.
async function recentLpMovers(pool: Hex, block: bigint): Promise<Hex[]> {
  try {
    const fromBlock = block > LP_TRANSFER_LOOKBACK_BLOCKS ? block - LP_TRANSFER_LOOKBACK_BLOCKS : 0n;
    const logs = await logsClient().getLogs({ address: pool, event: TRANSFER_EVENT, fromBlock, toBlock: block });
    const out = new Set<Hex>();
    for (const log of logs) {
      const { from, to } = log.args as { from?: Hex; to?: Hex };
      if (from) out.add(from);
      if (to) out.add(to);
    }
    return [...out];
  } catch {
    return []; // provider hiccup — an empty candidate list, not a failed probe
  }
}
