// Records real runs against a real fork and freezes them into
// shared/src/fixtures.ts. Engine seeds them into its cache; web replays them
// when no engine is configured.
//
//   pnpm --filter @sidik/engine fixtures                 # the EXAMPLES only
//   SIDIK_CATALOG=120 pnpm --filter @sidik/engine fixtures
//
// With SIDIK_CATALOG=N it also discovers the N most liquid Uniswap V2 tokens
// on Base and records those, so the demo answers far more than three
// addresses without an engine behind it.
//
// Requires BASE_ARCHIVE_RPC. VENICE_API_KEY is optional — without it the
// frozen narration is the deterministic template rather than model prose.
//
// Safe to interrupt and re-run: it loads what is already recorded for this
// fork block and skips those, writing after every token.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi, parseAbiItem, formatEther } from "viem";
import { base } from "viem/chains";
import { EXAMPLES } from "@sidik/shared";
import type { Hex, PreScan, Verdict } from "@sidik/shared";
import { isProbeFailure, runSidik } from "../src/orchestrator.js";
import { BASE_FORK_BLOCK } from "../src/examples.js";

const CATALOG_SIZE = Number(process.env.SIDIK_CATALOG ?? "0");
// ~70 days of Base blocks. The factory holds over 3M pairs, so enumerating it
// is out; PairCreated over a window is how the live ones get found. Pairs
// older than this are covered by SEED below.
const DISCOVERY_BLOCKS = BigInt(process.env.SIDIK_DISCOVERY_BLOCKS ?? "3000000");
// The logs RPC caps a single eth_getLogs at 10k blocks.
const LOG_CHUNK = 10_000n;
// Below this there is nothing to trade against, so a run would only ever
// report "no liquidity to test". Deliberately low: honeypots sit in small
// pools by nature — the one confirmed honeypot in the catalogue was found at
// 0.005 WETH — and a threshold that keeps the catalogue tidy also filters out
// exactly the tokens this tool exists to catch.
const MIN_WETH_RESERVE = BigInt(process.env.SIDIK_MIN_WETH ?? "10000000000000000"); // 0.01 WETH

const FACTORY: Hex = "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6";
const WETH: Hex = "0x4200000000000000000000000000000000000006";
const PAIR_CREATED = parseAbiItem(
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256 allPairs)",
);
const PAIR_ABI = parseAbi(["function getReserves() view returns (uint112,uint112,uint32)"]);
const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
]);
const V3_POOL_CREATED = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
);
const V3_FACTORY: Hex = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";

// Tokens whose V2 pair predates the discovery window but still holds real
// liquidity — verified by hand on 2026-08-20. Without these the catalog is
// all recent listings and misses the established ones.
const SEED: Hex[] = [
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
  "0x9a26F5433671751C3276a065f57e5a02D2817973", // KEYCAT
  "0xB1a03EdA10342529bBF8EB700a06C60441fEf25d", // MIGGLES
  // The best-known Base tokens. All of them trade on V3 rather than V2 —
  // the ones a judge types first, and the ones that used to answer "N/A".
  "0x532f27101965dd16442E59d40670FaF5eBB142E4", // BRETT
  "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4", // TOSHI
  "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", // DEGEN
  "0x940181a94A35A4569E4529A3CDfB74e38FD98631", // AERO
  // The rest of what a judge is likely to type. Some of these trade mostly
  // on Aerodrome or Curve and will come back N/A — that is still an answer
  // with a reason attached, which beats "no recorded run for this address".
  "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // cbBTC
  "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe", // HIGHER
  "0xF6e932Ca12afa26665dC4dDE7e27be02A7c02e50", // MOCHI
  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", // DAI
  "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", // USDbC
  "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", // cbETH
  "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", // VIRTUAL
];

const logsRpc = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_LOGS_RPC ?? "https://mainnet.base.org"),
});
const archive = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_ARCHIVE_RPC!),
  batch: { multicall: true },
});

const OUT = fileURLToPath(new URL("../../shared/src/fixtures.ts", import.meta.url));

interface FrozenRun { scan: PreScan; ids: string[]; verdicts: Verdict[]; narration: string }

/** What is already recorded for THIS fork block; anything else is stale. */
function loadExisting(): Record<string, FrozenRun> {
  try {
    const src = readFileSync(OUT, "utf8");
    const block = /FIXTURE_BLOCK = "(\d+)"/.exec(src)?.[1];
    if (block !== BASE_FORK_BLOCK.toString()) return {};
    const start = src.indexOf("FIXTURES: Record<string, FrozenRun> = ");
    if (start === -1) return {};
    // Stop at the object's own closing brace, not the end of the file. Exports
    // added after it — FIXTURE_COUNT — used to be swallowed into the slice,
    // which made the parse throw, which made this return {}, which silently
    // discarded every previously recorded run on the next write.
    const from = src.indexOf("{", start);
    // The newline is built with fromCharCode rather than written as an
    // escape sequence: escaping it here has twice produced a real line break
    // inside the literal, which is a syntax error the typechecker misses and
    // only the runtime reports.
    const objectEnd = String.fromCharCode(10) + "};";
    const end = src.indexOf(objectEnd, from);
    if (from === -1 || end === -1) return {};
    return JSON.parse(src.slice(from, end + 2)) as Record<string, FrozenRun>;
  } catch {
    return {};
  }
}

// Merge against whatever is on disk right now, not just what was loaded at
// startup. A long sweep that gets interrupted can still flush its own stale
// snapshot on the way out and silently drop runs another process recorded in
// the meantime — which is exactly how the wallet example disappeared once.
function write(runs: Record<string, FrozenRun>): void {
  const onDisk = loadExisting();
  runs = { ...onDisk, ...runs };
  const banner = `// GENERATED by engine/scripts/gen-fixtures.mts — do not edit by hand.
// Real output of real runs against a fork of Base at the block below. Engine
// seeds these into its cache so a known token needs no network; web replays
// them when no engine is configured. Regenerate with:
//
//   SIDIK_CATALOG=120 pnpm --filter @sidik/engine fixtures
//
import type { PreScan, Verdict } from "./types";

export interface FrozenRun {
  scan: PreScan;
  ids: string[];
  verdicts: Verdict[];
  narration: string;
}

// The fork block these were produced at. Bump BASE_FORK_BLOCK and they stop
// matching, so a stale run can never be passed off as proof about a new pin.
export const FIXTURE_BLOCK = "${BASE_FORK_BLOCK}";

export const FIXTURES: Record<string, FrozenRun> = `;
  // FIXTURE_COUNT is its own export so a client component can show the
  // number without importing the runs themselves. Reading
  // Object.keys(FIXTURES) in a browser bundle shipped all of them to it.
  const count = `

export const FIXTURE_COUNT = ${Object.keys(runs).length};
`;
  writeFileSync(OUT, banner + JSON.stringify(runs, null, 2) + ";" + count);
}

/** The most liquid Uniswap V2 tokens on Base, richest first. */
async function discover(limit: number): Promise<{ address: Hex; label: string }[]> {
  const pairs: { token: Hex; pair: Hex; wethIsToken0: boolean; v3?: boolean }[] = [];
  const from = BASE_FORK_BLOCK - DISCOVERY_BLOCKS;
  let done = 0n;
  for (let b = from; b < BASE_FORK_BLOCK; b += LOG_CHUNK) {
    const to = b + LOG_CHUNK - 1n > BASE_FORK_BLOCK ? BASE_FORK_BLOCK : b + LOG_CHUNK - 1n;
    try {
      const logs = await logsRpc.getLogs({ address: FACTORY, event: PAIR_CREATED, fromBlock: b, toBlock: to });
      for (const log of logs) {
        const a = log.args as { token0?: Hex; token1?: Hex; pair?: Hex };
        if (!a.token0 || !a.token1 || !a.pair) continue;
        const wethIsToken0 = a.token0.toLowerCase() === WETH.toLowerCase();
        if (!wethIsToken0 && a.token1.toLowerCase() !== WETH.toLowerCase()) continue;
        pairs.push({ token: (wethIsToken0 ? a.token1 : a.token0), pair: a.pair, wethIsToken0 });
      }
    } catch {
      process.stderr.write(`  logs ${b}-${to} failed, skipping\n`);
    }
    // V3 as well: the deepest Base liquidity is there, and a V2-only sweep
    // catalogues fresh listings while missing everything established.
    try {
      const logs = await logsRpc.getLogs({ address: V3_FACTORY, event: V3_POOL_CREATED, fromBlock: b, toBlock: to });
      for (const log of logs) {
        const a = log.args as { token0?: Hex; token1?: Hex; pool?: Hex };
        if (!a.token0 || !a.token1 || !a.pool) continue;
        const wethIsToken0 = a.token0.toLowerCase() === WETH.toLowerCase();
        if (!wethIsToken0 && a.token1.toLowerCase() !== WETH.toLowerCase()) continue;
        pairs.push({ token: (wethIsToken0 ? a.token1 : a.token0), pair: a.pool, wethIsToken0, v3: true });
      }
    } catch { /* the V2 pass already reported this window */ }
    done += LOG_CHUNK;
    if (done % 300_000n === 0n) process.stderr.write(`  scanned ${done}/${DISCOVERY_BLOCKS} blocks, ${pairs.length} WETH pairs\n`);
  }
  process.stderr.write(`  ${pairs.length} WETH pairs created in window\n`);

  // Multicall, not one call per pair: a per-call sweep of thousands of pairs
  // rate-limits the RPC into uselessness.
  const liquid: { address: Hex; label: string; weth: bigint }[] = [];
  const BATCH = 400;
  for (let i = 0; i < pairs.length; i += BATCH) {
    const batch = pairs.slice(i, i + BATCH);
    const reserves = await archive.multicall({
      contracts: batch.map((p) => p.v3
        ? ({ address: WETH, abi: ERC20_ABI, functionName: "balanceOf", args: [p.pair] } as const)
        : ({ address: p.pair, abi: PAIR_ABI, functionName: "getReserves" } as const)),
      blockNumber: BASE_FORK_BLOCK,
      allowFailure: true,
    });
    const keep: typeof batch = [];
    const weths: bigint[] = [];
    reserves.forEach((r, j) => {
      if (r.status !== "success") return;
      // A V2 pair reports reserves; a V3 pool simply holds the WETH, so its
      // balance is the same measurement reached a different way.
      let weth: bigint;
      if (batch[j].v3) {
        weth = r.result as unknown as bigint;
      } else {
        const [r0, r1] = r.result as unknown as [bigint, bigint, number];
        weth = batch[j].wethIsToken0 ? r0 : r1;
      }
      if (weth < MIN_WETH_RESERVE) return;
      keep.push(batch[j]);
      weths.push(weth);
    });
    if (keep.length) {
      const symbols = await archive.multicall({
        contracts: keep.map((p) => ({ address: p.token, abi: ERC20_ABI, functionName: "symbol" } as const)),
        blockNumber: BASE_FORK_BLOCK,
        allowFailure: true,
      });
      keep.forEach((p, j) => liquid.push({
        address: p.token,
        label: symbols[j].status === "success" ? String(symbols[j].result) : "?",
        weth: weths[j],
      }));
    }
    process.stderr.write(`  reserves ${Math.min(i + BATCH, pairs.length)}/${pairs.length} -> ${liquid.length} liquid\r`);
  }
  process.stderr.write("\n");
  liquid.sort((a, b) => (b.weth > a.weth ? 1 : -1));
  process.stderr.write(`  ${liquid.length} liquid; taking top ${limit}\n`);
  return liquid.slice(0, limit).map((t) => ({ address: t.address, label: `${t.label} (${Number(formatEther(t.weth)).toFixed(2)} WETH)` }));
}

/** One run, or undefined if it broke rather than reached a verdict. */
async function record(token: Hex, mustBeToken = true): Promise<FrozenRun | undefined> {
  let scan: PreScan | undefined;
  let ids: string[] = [];
  const verdicts: Verdict[] = [];
  let narration = "";
  let failed: string | undefined;

  // Bypass the cache: it is seeded from the file this script rewrites, so
  // reading it would replay the previous run instead of producing a new one.
  for await (const ev of runSidik(token, { getCached: () => undefined, setCached: () => {} })) {
    if (ev.type === "prescan") scan = ev.scan;
    else if (ev.type === "plan") ids = ev.ids;
    else if (ev.type === "verdict") verdicts.push(ev.verdict);
    else if (ev.type === "narration") narration = ev.text;
    else if (ev.type === "error") failed = ev.message;
  }

  // A run that broke proves nothing, and freezing it would hand judges a
  // permanent failure no retry can clear. That includes a probe that threw:
  // an RPC 429 mid-fork surfaces as an NA verdict, not an error event, and
  // one slipped into the first generated set looking like a finding.
  // A DISCOVERED address that turns out not to be a token has nothing to say
  // in a token catalogue — it only ever yields the wallet probe reporting no
  // approvals, which is noise. An explicitly listed target is listed on
  // purpose: the wallet example is not a token and that is the point.
  if (mustBeToken && scan && !scan.isErc20) {
    process.stderr.write("SKIPPED (not an ERC-20)\n");
    return undefined;
  }
  const broken = verdicts.find(isProbeFailure);
  if (failed || !scan || broken) {
    process.stderr.write(`SKIPPED (${(failed ?? broken?.title ?? "no prescan").slice(0, 70)})\n`);
    return undefined;
  }
  return { scan, ids, verdicts, narration };
}

// ---- main ----------------------------------------------------------------

const runs = loadExisting();
const already = Object.keys(runs).length;
if (already) process.stderr.write(`resuming: ${already} already recorded at block ${BASE_FORK_BLOCK}\n`);

const targets: { address: Hex; label: string; mustBeToken?: boolean }[] = [
  ...EXAMPLES.map((e) => ({ address: e.address, label: e.label, mustBeToken: e.kind !== "wallet" })),
  ...SEED.map((address) => ({ address, label: "seed" })),
];
if (CATALOG_SIZE > 0) {
  process.stderr.write(`discovering the ${CATALOG_SIZE} most liquid Uniswap V2 tokens on Base...\n`);
  targets.push(...await discover(CATALOG_SIZE));
}

const seen = new Set<string>();
const queue = targets.filter((t) => {
  const k = t.address.toLowerCase();
  if (seen.has(k) || runs[k]) return false;
  seen.add(k);
  return true;
});
process.stderr.write(`${queue.length} to record\n\n`);

// Windows fails new process creation with 0xC0000142 (DLL init) once a
// session has churned through enough of them — it is desktop-heap exhaustion,
// not anything about the token being probed. Three sweeps died on it. A short
// pause between tokens lets terminated anvils release before the next spawn.
const BREATHE_MS = 400;

let i = 0;
for (const t of queue) {
  i++;
  if (i > 1) await new Promise((r) => setTimeout(r, BREATHE_MS));
  process.stderr.write(`[${i}/${queue.length}] ${t.label} ${t.address} ... `);
  const run = await record(t.address, t.mustBeToken ?? true);
  if (!run) continue;
  runs[t.address.toLowerCase()] = run;
  write(runs); // after every token, so an interrupted run keeps its progress
  process.stderr.write(`${run.verdicts.map((v) => `${v.probe}=${v.status}`).join(" ")}\n`);
}

write(runs);
process.stderr.write(`\nwrote ${Object.keys(runs).length} recorded run(s) at block ${BASE_FORK_BLOCK}\n-> ${OUT}\n`);
