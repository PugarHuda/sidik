import { createPublicClient, http, encodeFunctionData, formatEther, parseAbi, parseAbiItem } from "viem";
import { base } from "viem/chains";
import type { RawResult, ProbeCtx, Verdict, Hex, Probe } from "@sidik/shared";
import { logsClient } from "../rpc.js";

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
]);

const APPROVAL_EVENT = parseAbiItem("event Approval(address indexed owner, address indexed spender, uint256 value)");

const APPROVAL_LOOKBACK_BLOCKS = 3_000n;

// ponytail: duplicated from dex.ts (not exported there) rather than exporting
// it just for this probe — same Uniswap V2 router/WETH already used elsewhere.
const ROUTER: Hex = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";
const ROUTER_ABI = parseAbi(["function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)"]);
const WETH: Hex = "0x4200000000000000000000000000000000000006";

// ponytail: static WETH price, not a general pricing subsystem. Swap for an
// on-chain oracle/stable-pool read if precision matters later.
const WETH_USD = 3000;

// ponytail: fixed non-victim/non-spender EOA that just needs to receive the
// drained tokens on the fork; built via .repeat so the digit count is
// obviously right rather than a hand-counted hex literal.
const ATTACKER = (`0x${"0".repeat(35)}a11ce`) as Hex;

function formatUsd(raw: string): string {
  const n = Number(raw);
  const safe = Number.isFinite(n) ? n : 0;
  return `$${safe.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function interpretApprovalDrain(raw: RawResult, _ctx: ProbeCtx): Verdict {
  const approvals = (raw.approvals ?? []) as { spender: Hex; allowance: string; reachableUsd: string }[];
  const drainedUsd = String(raw.drainedUsd ?? "0");
  const reachableUsdTotal = approvals.reduce((sum, a) => sum + (Number(a.reachableUsd) || 0), 0);
  const txHashes = [raw.drainTxHash as Hex].filter((h) => h && h !== "0x") as Hex[];
  // The real safety signal is whether transferFrom actually moved tokens —
  // drainedUsd is display decoration and can be 0 for an unpriceable token
  // (no WETH route) even though the drain genuinely happened. A genuine
  // (non-"0x") drainTxHash is itself proof a drain landed on-chain.
  const drained = Boolean(raw.drained) || txHashes.length > 0;
  const numbers = {
    reachableUsd: formatUsd(String(reachableUsdTotal)),
    drainedUsd: Number(drainedUsd) > 0 ? formatUsd(drainedUsd) : (drained ? "unpriced" : formatUsd(drainedUsd)),
    approvalCount: String(approvals.length),
  };

  if (approvals.length === 0) {
    return {
      probe: "approvalDrain", status: "NA", title: "No live approvals to test",
      rows: [{ label: "Live token approvals", claimed: "n/a", proven: "No approvals found for this wallet", ok: true }],
      numbers, txHashes,
    };
  }

  if (drained) {
    return {
      probe: "approvalDrain", status: "FAIL", title: "Approvals are drainable — funds actually moved",
      rows: [{ label: "Approved spenders can pull funds", claimed: "Approvals are safe",
        proven: `Drained ${numbers.drainedUsd} via transferFrom`, ok: false }],
      numbers, txHashes,
    };
  }

  return {
    probe: "approvalDrain", status: "PASS", title: "Approvals exist but none were drainable",
    rows: [{ label: "Approved spenders can pull funds", claimed: "Approvals are safe",
      proven: "transferFrom did not move funds", ok: true }],
    numbers, txHashes,
  };
}

// ponytail: `any` here, not the full viem PublicClient<Base> generic — the
// literal client instance's chain-formatter type is call-site-specific and
// not worth threading through for a single readContract call.
async function priceUsd(pub: any, token: Hex, amount: bigint): Promise<number> {
  if (amount === 0n) return 0;
  try {
    const amounts = await pub.readContract({
      address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [amount, [token, WETH]],
    }) as bigint[];
    return Number(formatEther(amounts[1])) * WETH_USD;
  } catch {
    // ponytail: no V2 route/pool for this token — treat as unpriced, not fatal.
    return 0;
  }
}

export const approvalDrainProbe: Probe = {
  id: "approvalDrain",
  title: "Approval-drain probe",
  // This probe targets a wallet, not a token — only applicable when the
  // pasted input wasn't recognized as an ERC-20.
  applicableWhen: (s) => !s.isErc20,
  async setup() { /* no fork funding needed; spenders are impersonated, not funded */ },
  async execute(fork, ctx): Promise<RawResult> {
    // ponytail: ProbeCtx/PreScan carry no dedicated wallet field — wallet-vs-token
    // input routing is properly resolved later at the orchestrator (Task 13).
    // Until then, ctx.token is the pasted address, and applicableWhen only lets
    // this probe run when that address wasn't recognized as an ERC-20 token —
    // so it IS the victim wallet.
    const victim = ctx.token;
    const pub = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });

    // ponytail: single-call window over the dedicated logs RPC (see rpc.ts) —
    // ~1.7h of Base blocks, so only RECENT approvals are found. Widen with a
    // chunked scan if a demo needs deeper history; the endpoint allows it.
    const fromBlock = ctx.block > APPROVAL_LOOKBACK_BLOCKS ? ctx.block - APPROVAL_LOOKBACK_BLOCKS : 0n;
    const logs = await logsClient().getLogs({ event: APPROVAL_EVENT, args: { owner: victim }, fromBlock, toBlock: ctx.block });

    // Dedupe by (token, spender) — latest Approval log overwrites the prior
    // allowance on-chain, so last-in wins.
    const latest = new Map<string, { token: Hex; spender: Hex }>();
    for (const log of logs) {
      const token = log.address as Hex;
      const spender = (log.args as { spender?: Hex }).spender;
      if (!spender) continue;
      latest.set(`${token}:${spender}`, { token, spender });
    }

    const approvals: { spender: Hex; allowance: string; reachableUsd: string; token: Hex }[] = [];
    let drainedUsdTotal = 0;
    let drainTxHash: Hex = "0x" as Hex;
    let drained = false;

    for (const { token, spender } of latest.values()) {
      const allowance = await fork.read<bigint>({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [victim, spender] });
      if (allowance === 0n) continue;
      const balance = await fork.read<bigint>({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [victim] });
      const reachable = allowance < balance ? allowance : balance;
      if (reachable === 0n) continue;

      const reachableUsd = await priceUsd(pub, token, reachable);

      await fork.impersonate(spender);
      const before = await fork.read<bigint>({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [ATTACKER] });
      const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "transferFrom", args: [victim, ATTACKER, reachable] });
      const { hash, reverted } = await fork.send({ from: spender, to: token, data });
      await fork.stopImpersonate(spender);

      let drainedAmt = 0n;
      if (!reverted) {
        const after = await fork.read<bigint>({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [ATTACKER] });
        drainedAmt = after - before;
        if (drainedAmt > 0n) { drainTxHash = hash; drained = true; }
      }
      const drainedUsd = drainedAmt === reachable ? reachableUsd : await priceUsd(pub, token, drainedAmt);
      drainedUsdTotal += drainedUsd;

      approvals.push({ spender, allowance: allowance.toString(), reachableUsd: reachableUsd.toString(), token });
    }

    return { approvals, drainedUsd: drainedUsdTotal.toString(), drainTxHash, drained };
  },
  interpret: interpretApprovalDrain,
};
