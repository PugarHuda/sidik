import { createPublicClient, encodeFunctionData, formatEther, http, parseAbi, parseAbiItem, toEventSelector } from "viem";
import { base } from "viem/chains";
import type { RawResult, ProbeCtx, Verdict, Hex, Probe, ForkClient } from "@sidik/shared";
import { logsClient } from "../rpc.js";
import { log } from "../log.js";
import { amount } from "../format.js";
import { BURN_ADDRESSES, UNISWAP_V2, WETH } from "../base.js";
import { ERC20_ABI, TRANSFER_EVENT, V2_ROUTER_ABI } from "../abi.js";
import { quoteV3 } from "../dexV3.js";
import { classifyHolder, codeAt, isoDate, UNCX_V2_LOCKER, uncxV2Lock, type HolderKind } from "../lockers.js";

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

// 9k blocks — the logs RPC caps a single eth_getLogs at 10k, so this takes
// the window right up to what one request allows. At 3k the holder sample
// came back empty for 56% of the catalogue, which is what starved lpRug's
// candidate search and left it saying NA more often than not.
const LP_TRANSFER_LOOKBACK_BLOCKS = 9_000n;

// Uniswap V3 NonfungiblePositionManager on Base — Blockscout-verified 2026-08-28.
const V3_NPM: Hex = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1";
const V3_NPM_ABI = parseAbi([
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "struct DecreaseLiquidityParams { uint256 tokenId; uint128 liquidity; uint256 amount0Min; uint256 amount1Min; uint256 deadline; }",
  "function decreaseLiquidity(DecreaseLiquidityParams params) payable returns (uint256 amount0, uint256 amount1)",
  "struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }",
  "function collect(CollectParams params) payable returns (uint256 amount0, uint256 amount1)",
]);
const V3_POOL_ABI = parseAbi(["function liquidity() view returns (uint128)"]);
const V3_MINT_EVENT = parseAbiItem(
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
);
const NPM_INCREASE_EVENT = parseAbiItem(
  "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
);
// Receipts are one RPC each; a busy pool mints hundreds of times in 9k blocks
// and the largest position is almost always among the most recent.
const MAX_V3_MINT_RECEIPTS = 25;
const MAX_UINT128 = (1n << 128n) - 1n;

const ROW_LABEL = "LP owner can drain the pool";
const CLAIMED = "Liquidity is locked/safe";

export function interpretLpRug(raw: RawResult, _ctx: ProbeCtx): Verdict {
  const v3 = raw.venue === "v3";
  // Kept for runs recorded before V3 positions were pulled; no longer produced.
  if (raw.notApplicable === "v3") {
    return {
      probe: "lpRug", status: "NA",
      title: "LP rug does not apply — this token trades on Uniswap V3",
      rows: [{ label: ROW_LABEL, claimed: CLAIMED,
        proven: "V3 liquidity is held as NFT positions, not a fungible LP token an owner can pull", ok: false }],
      numbers: { venue: "uniswap-v3" }, txHashes: [], applicable: false,
    };
  }

  const ownerLpPct = Number(raw.ownerLpPct ?? 0);
  const lpOwner = String(raw.lpOwner ?? "0x0") as Hex;
  const holderKind = (raw.holderKind as HolderKind | undefined) ?? "eoa";
  // priceHolder returns whole ether as a decimal string, so re-express it in
  // wei before formatting; an 18-place tail on screen reads as noise.
  const toWei = (v: unknown): bigint => {
    const [w = "0", f = ""] = String(v ?? "0").split(".");
    try { return BigInt(w) * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18)); } catch { return 0n; }
  };
  const beforeWei = toWei(raw.holderValueBefore);
  const afterWei = toWei(raw.holderValueAfter);
  const before = amount(beforeWei, 18, "WETH");
  const after = amount(afterWei, 18, "WETH");
  const pct = `${Math.round(ownerLpPct)}%`;
  const burnedPct = Number(raw.burnedLpPct ?? 0);
  const burned = `${burnedPct.toFixed(2).replace(/[.]00$/, "")}%`;
  const txHashes = [raw.pullTxHash as Hex].filter((h) => h && h !== "0x") as Hex[];
  const numbers: Record<string, string> = {
    ownerLpPct: pct, burnedLpPct: burned, holderValueBefore: before, holderValueAfter: after, lpOwner,
    ...(v3 ? { venue: "uniswap-v3", positionId: String(raw.positionId ?? "") } : {}),
    ...(holderKind !== "eoa" ? { lpHolderKind: holderKind } : {}),
  };
  // On V3 "LP" is the largest position found and its share is of the pool's
  // active liquidity, which is the part a pull removes from the price.
  const share = v3 ? `${pct} of active liquidity` : `${pct} of LP`;

  // "Collapsed" = after is a small fraction of before (rug drained the pool).
  const beforeN = Number(beforeWei);
  const afterN = Number(afterWei);
  const collapsed = beforeN > 0 && afterN <= beforeN * 0.5;

  // Burned LP is unreachable by definition, so this is a positive proof of
  // safety rather than an absence of evidence — and it needs no holder
  // discovery to establish.
  if (burnedPct >= BURNED_LP_PCT_FOR_PASS) {
    return {
      probe: "lpRug", status: "PASS", title: `LP is burned — ${burned} of it cannot be withdrawn by anyone`,
      rows: [{ label: ROW_LABEL, claimed: CLAIMED,
        proven: `${burned} of LP supply sits at a burn address, beyond any owner's reach`, ok: true }],
      numbers, txHashes,
    };
  }

  // A locker is the one holder whose LP cannot be pulled by anyone until a
  // date the contract enforces. Impersonating it would have "proven" a rug
  // the locker exists to prevent; reading the lock is the honest test.
  if (holderKind === "uncx-locker") {
    const until = String(raw.lockUnlockDate ?? "");
    numbers.lockUnlockDate = until || "unknown";
    if (raw.lockedPct !== undefined) numbers.lockedPct = `${Number(raw.lockedPct).toFixed(2).replace(/0+$/, "").replace(/[.]$/, "")}%`;
    return {
      probe: "lpRug", status: "PASS",
      title: until ? `LP locked until ${until} in UNCX — could not be pulled` : "LP is held by the UNCX locker — could not be pulled",
      rows: [{ label: ROW_LABEL, claimed: CLAIMED,
        proven: `${share} sits in UNCX's locker contract${until ? `, unlockable on ${until}` : ""}; no owner can withdraw it before then`, ok: true }],
      numbers, txHashes,
    };
  }

  // A contract with logic of its own (a vesting contract, a DAO treasury, an
  // unknown locker). anvil can impersonate it, but the pull would then bypass
  // whatever that logic enforces — so it would prove nothing about the pool.
  if (holderKind === "contract" && raw.lpHolderFound) {
    return {
      probe: "lpRug", status: "NA",
      title: `LP held by contract ${lpOwner.slice(0, 6)}…${lpOwner.slice(-4)}; pulling it needs that contract's own logic`,
      rows: [{ label: ROW_LABEL, claimed: CLAIMED,
        proven: `${share} is held by a contract Sidik does not recognise; whether it can be withdrawn depends on that contract's code`, ok: false }],
      numbers, txHashes,
    };
  }

  if (v3 && raw.noPositionReason) {
    return {
      probe: "lpRug", status: "NA", title: "No V3 position could be found to pull",
      rows: [{ label: ROW_LABEL, claimed: CLAIMED, proven: String(raw.noPositionReason), ok: false }],
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
      rows: [{ label: ROW_LABEL, claimed: CLAIMED,
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
      rows: [{ label: ROW_LABEL, claimed: CLAIMED,
        proven: "Could not price any holder's position before the pull", ok: false }],
      numbers, txHashes,
    };
  }

  const who = holderKind === "safe" ? "a Safe multisig" : "owner";
  if (collapsed) {
    return {
      probe: "lpRug", status: "FAIL",
      title: holderKind === "safe" ? "LP rug possible — a Safe multisig can pull all liquidity" : "LP rug possible — owner can pull all liquidity",
      rows: [{ label: ROW_LABEL, claimed: CLAIMED,
        proven: `${who === "owner" ? "Owner" : "A Safe multisig"} holds ${share} and removing it collapsed a holder's position from ${before} to ${after}`, ok: false }],
      numbers, txHashes,
    };
  }

  return {
    probe: "lpRug", status: "PASS", title: "LP is locked/burned — no single-owner rug path",
    rows: [{ label: ROW_LABEL, claimed: CLAIMED,
      proven: `Largest LP holder found controls only ${share}`, ok: true }],
    numbers, txHashes,
  };
}

export const lpRugProbe: Probe = {
  id: "lpRug",
  title: "LP-rug probe",
  applicableWhen: (s) => s.isErc20 && s.hasPool,
  async setup() { /* the LP owner is discovered during execute, and funded for gas there */ },
  async execute(fork: ForkClient, ctx: ProbeCtx): Promise<RawResult> {
    if (ctx.scan.venue === "v3") return executeV3(fork, ctx);

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
    // token, whoever recently moved the LP token itself — and the UNCX locker,
    // so a lock older than the log window is still found. Burn addresses are
    // excluded — their LP is unreachable, so impersonating one would prove
    // nothing about whether this pool can be rugged.
    const unreachable = new Set(BURN_ADDRESSES.map((a) => a.toLowerCase()));
    const candidates = [
      ctx.scan.owner,
      ...ctx.scan.topHolders.map((h) => h.address),
      ...(await recentLpMovers(pool, ctx.block)),
      UNCX_V2_LOCKER,
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
          address: UNISWAP_V2.router, abi: V2_ROUTER_ABI, functionName: "getAmountsOut", args: [bal, [ctx.token, WETH]],
        });
        // Last hop, defaulted — same access dex.ts and approvalDrain.ts use.
        // Indexing [1] blindly threw a TypeError on any router answer shorter
        // than the path, and the catch below turned that into a silent "0".
        return formatEther(amounts[amounts.length - 1] ?? 0n);
      } catch {
        return "0"; // ponytail: no route left (e.g. pool already drained) — value is 0
      }
    };

    const holderValueBefore = await priceHolder();

    if (lpBalance === 0n) {
      return { ...nothingFound(burnedLpPct), holderValueBefore, holderValueAfter: holderValueBefore };
    }

    const ownerLpPct = Math.round(Number((lpBalance * 10000n) / totalSupply) / 100);
    const holderKind = classifyHolder(lpOwner, await codeAt(fork, lpOwner));
    const found = { lpOwner, lpHolderFound: true, ownerLpPct, burnedLpPct, holderValueBefore, holderKind };

    if (holderKind === "uncx-locker") {
      const lock = await uncxV2Lock(fork, pool);
      return {
        ...found, holderValueAfter: holderValueBefore, pullTxHash: "0x" as Hex,
        lockUnlockDate: lock ? isoDate(lock.unlockDate) : "",
        lockedPct: lock ? Number((lock.amount * 10000n) / totalSupply) / 100 : ownerLpPct,
      };
    }
    if (holderKind === "contract") {
      return { ...found, holderValueAfter: holderValueBefore, pullTxHash: "0x" as Hex };
    }

    await fork.impersonate(lpOwner);
    // Impersonation gets you the sender, not their gas. A real LP owner who
    // wanted to rug would have ETH; on a fork we hand it to them so the probe
    // measures whether the pool CAN be drained rather than whether this
    // particular account happens to hold gas money. Seven tokens in the
    // catalogue failed outright on "total cost exceeds the balance" before
    // this, and the failure looked like a finding.
    await fork.setBalanceEth(lpOwner, "1");
    const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [UNISWAP_V2.router, lpBalance] });
    const approveTx = await fork.send({ from: lpOwner, to: pool, data: approveData });

    let pullTxHash: Hex = approveTx.hash;
    let holderValueAfter = holderValueBefore;
    if (!approveTx.reverted) {
      const removeData = encodeFunctionData({
        abi: V2_ROUTER_ABI, functionName: "removeLiquidity",
        args: [ctx.token, WETH, lpBalance, 0n, 0n, lpOwner, DEADLINE],
      });
      const removeTx = await fork.send({ from: lpOwner, to: UNISWAP_V2.router, data: removeData });
      pullTxHash = removeTx.hash;
      if (!removeTx.reverted) holderValueAfter = await priceHolder();
    }
    await fork.stopImpersonate(lpOwner);

    return { ...found, holderValueAfter, pullTxHash };
  },
  interpret: interpretLpRug,
};

/**
 * V3: liquidity is NFT positions, and a position's owner pulls it exactly as
 * a V2 LP holder does — decreaseLiquidity then collect through the position
 * manager. 104 of 194 recorded tokens trade on V3 and every one of them was
 * getting "does not apply" for the check a single-position Clanker launch
 * needs most.
 *
 * Positions are found from the pool's own Mint events in the same window V2
 * uses, mapped to token ids through the manager's IncreaseLiquidity log in
 * each mint's receipt.
 */
async function executeV3(fork: ForkClient, ctx: ProbeCtx): Promise<RawResult> {
  const pool = ctx.scan.poolAddress;
  const fee = ctx.scan.poolFee ?? 3000;
  const base_ = {
    venue: "v3", lpOwner: NO_LP_OWNER, lpHolderFound: false, ownerLpPct: 0, burnedLpPct: 0,
    holderValueBefore: "0", holderValueAfter: "0", pullTxHash: "0x" as Hex,
  };
  if (!pool) return { ...base_, noPositionReason: "No V3 pool address in the pre-scan" };

  const sampleHolder = ctx.scan.topHolders[0]?.address;
  const priceHolder = async (): Promise<string> => {
    if (!sampleHolder) return "0";
    const bal = await fork.read<bigint>({ address: ctx.token, abi: ERC20_ABI, functionName: "balanceOf", args: [sampleHolder] });
    return formatEther(await quoteV3(fork, ctx.token, WETH, bal, fee));
  };

  const positions = await recentV3Positions(fork, pool, ctx.block);
  if (positions === undefined) {
    return { ...base_, noPositionReason: `The logs RPC could not be read for the pool's last ${LP_TRANSFER_LOOKBACK_BLOCKS.toLocaleString("en-US")} blocks` };
  }
  let best: { tokenId: bigint; liquidity: bigint } | undefined;
  for (const tokenId of positions) {
    const pos = await fork.read<readonly [bigint, Hex, Hex, Hex, number, number, number, bigint]>({
      address: V3_NPM, abi: V3_NPM_ABI, functionName: "positions", args: [tokenId],
    });
    const [, , token0, token1, posFee, , , liquidity] = pos;
    const isThisPool = [token0.toLowerCase(), token1.toLowerCase()].includes(ctx.token.toLowerCase()) && posFee === fee;
    if (isThisPool && liquidity > 0n && (!best || liquidity > best.liquidity)) best = { tokenId, liquidity };
  }
  if (!best) {
    return { ...base_, noPositionReason: `No position with liquidity was minted into this pool in the last ${LP_TRANSFER_LOOKBACK_BLOCKS.toLocaleString("en-US")} blocks (${positions.length} mint${positions.length === 1 ? "" : "s"} seen)` };
  }

  const active = await fork.read<bigint>({ address: pool, abi: V3_POOL_ABI, functionName: "liquidity" });
  const ownerLpPct = active > 0n ? Math.min(100, Math.round(Number((best.liquidity * 10000n) / active) / 100)) : 0;
  const lpOwner = await fork.read<Hex>({ address: V3_NPM, abi: V3_NPM_ABI, functionName: "ownerOf", args: [best.tokenId] });
  const holderValueBefore = await priceHolder();
  const holderKind = classifyHolder(lpOwner, await codeAt(fork, lpOwner));
  const found = {
    ...base_, lpOwner, lpHolderFound: true, ownerLpPct, holderValueBefore, holderValueAfter: holderValueBefore,
    positionId: best.tokenId.toString(), holderKind,
  };
  // A position at a burn address is as unpullable as burned V2 LP.
  if (BURN_ADDRESSES.some((a) => a.toLowerCase() === lpOwner.toLowerCase())) return { ...found, burnedLpPct: 100 };
  // ponytail: the V3 locker has no per-position index, so the unlock date is
  // not read here; the holder being the locker is what makes the pull impossible.
  if (holderKind === "uncx-locker" || holderKind === "contract") return found;

  await fork.impersonate(lpOwner);
  await fork.setBalanceEth(lpOwner, "1");
  const decrease = await fork.send({
    from: lpOwner, to: V3_NPM,
    data: encodeFunctionData({
      abi: V3_NPM_ABI, functionName: "decreaseLiquidity",
      args: [{ tokenId: best.tokenId, liquidity: best.liquidity, amount0Min: 0n, amount1Min: 0n, deadline: DEADLINE }],
    }),
  });
  let pullTxHash: Hex = decrease.hash;
  let holderValueAfter = holderValueBefore;
  if (!decrease.reverted) {
    const collect = await fork.send({
      from: lpOwner, to: V3_NPM,
      data: encodeFunctionData({
        abi: V3_NPM_ABI, functionName: "collect",
        args: [{ tokenId: best.tokenId, recipient: lpOwner, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
      }),
    });
    pullTxHash = collect.hash;
    holderValueAfter = await priceHolder();
  }
  await fork.stopImpersonate(lpOwner);
  return { ...found, holderValueAfter, pullTxHash };
}

/** Token ids of positions minted into `pool` recently; undefined when the logs could not be read. */
async function recentV3Positions(fork: ForkClient, pool: Hex, block: bigint): Promise<bigint[] | undefined> {
  const fromBlock = block > LP_TRANSFER_LOOKBACK_BLOCKS ? block - LP_TRANSFER_LOOKBACK_BLOCKS : 0n;
  let mints: { transactionHash: Hex }[];
  try {
    mints = await logsClient().getLogs({ address: pool, event: V3_MINT_EVENT, fromBlock, toBlock: block });
  } catch (e) {
    log.error({ event: "lpRug.v3MintLogsFailed", reason: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
  const pub = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });
  const ids = new Set<bigint>();
  const hashes = [...new Set(mints.map((m) => m.transactionHash))].slice(-MAX_V3_MINT_RECEIPTS);
  for (const hash of hashes) {
    try {
      const receipt = await pub.getTransactionReceipt({ hash });
      for (const l of receipt.logs) {
        if (l.address.toLowerCase() !== V3_NPM.toLowerCase()) continue;
        if (l.topics[0] !== NPM_INCREASE_TOPIC || !l.topics[1]) continue;
        ids.add(BigInt(l.topics[1]));
      }
    } catch (e) {
      log.error({ event: "lpRug.v3ReceiptFailed", reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return [...ids];
}
const NPM_INCREASE_TOPIC = toEventSelector(NPM_INCREASE_EVENT);

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
  } catch (e) {
    // A provider hiccup here shrinks the candidate list, and a shrunken list
    // reads as "holder could not be identified" — a finding about the network
    // wearing the clothes of a finding about the token. Logged so the
    // generator's failure detection can see it.
    log.error({ event: "lpRug.lpMoversFailed", reason: e instanceof Error ? e.message : String(e) });
    return [];
  }
}
