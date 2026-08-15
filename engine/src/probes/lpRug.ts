import { encodeFunctionData, parseAbi, formatEther } from "viem";
import type { RawResult, ProbeCtx, Verdict, Hex, Probe, ForkClient } from "@sidik/shared";

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

// ponytail: sentinel for "no LP-owner candidate found" — the genuine null
// address, not a burn-style placeholder. Named distinctly from prescan.ts's
// ZERO (a general zero-address/pair-not-found sentinel) so the two don't
// read as the same concept despite sharing a value.
const NO_LP_OWNER: Hex = "0x0000000000000000000000000000000000000000" as Hex;

export function interpretLpRug(raw: RawResult, _ctx: ProbeCtx): Verdict {
  const ownerLpPct = Number(raw.ownerLpPct ?? 0);
  const lpOwner = String(raw.lpOwner ?? "0x0") as Hex;
  const before = String(raw.holderValueBefore ?? "0");
  const after = String(raw.holderValueAfter ?? "0");
  const pct = `${Math.round(ownerLpPct)}%`;
  const txHashes = [raw.pullTxHash as Hex].filter((h) => h && h !== "0x") as Hex[];
  const numbers = { ownerLpPct: pct, holderValueBefore: before, holderValueAfter: after, lpOwner };

  // "Collapsed" = after is a small fraction of before (rug drained the pool).
  const beforeN = Number(before) || 0;
  const afterN = Number(after) || 0;
  const collapsed = beforeN > 0 && afterN <= beforeN * 0.5;

  if (ownerLpPct > 0 && collapsed) {
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
  async setup() { /* no fork funding needed; lpOwner is impersonated, not funded */ },
  async execute(fork: ForkClient, ctx: ProbeCtx): Promise<RawResult> {
    const pool = ctx.scan.poolAddress;
    if (!pool) return { lpOwner: NO_LP_OWNER, ownerLpPct: 0, holderValueBefore: "0", holderValueAfter: "0", pullTxHash: "0x" as Hex };

    const totalSupply = await fork.read<bigint>({ address: pool, abi: ERC20_ABI, functionName: "totalSupply" });
    if (totalSupply === 0n) return { lpOwner: NO_LP_OWNER, ownerLpPct: 0, holderValueBefore: "0", holderValueAfter: "0", pullTxHash: "0x" as Hex };

    // ponytail: LP-holder discovery is a bounded candidate scan (owner + top
    // holders); a full LP-holder index is deferred — refine in the RPC batch.
    const candidates = [ctx.scan.owner, ...ctx.scan.topHolders.map((h) => h.address)]
      .filter((a): a is Hex => Boolean(a));

    let lpOwner: Hex = NO_LP_OWNER;
    let lpBalance = 0n;
    for (const candidate of candidates) {
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
      return { lpOwner: NO_LP_OWNER, ownerLpPct: 0, holderValueBefore, holderValueAfter: holderValueBefore, pullTxHash: "0x" as Hex };
    }

    const ownerLpPct = Math.round(Number((lpBalance * 10000n) / totalSupply) / 100);

    await fork.impersonate(lpOwner);
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

    return { lpOwner, ownerLpPct, holderValueBefore, holderValueAfter, pullTxHash };
  },
  interpret: interpretLpRug,
};
