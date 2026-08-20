import type { Hex, PreScan, Verdict, Probe, ForkClient, ProbeCtx } from "@sidik/shared";
import { withFork } from "./fork.js";
import { prescan as realPrescan } from "./prescan.js";
import { planProbes as realPlanProbes } from "./planner.js";
import { narrate as realNarrate } from "./narrator.js";
import { PROBES } from "./probes/registry.js";
import { BASE_FORK_BLOCK } from "./examples.js";
import { getCached, setCached } from "./cache.js";

export type RunEvent =
  | { type: "prescan"; scan: PreScan }
  | { type: "plan"; ids: string[] }
  | { type: "probe:start"; id: string }
  | { type: "verdict"; verdict: Verdict }
  | { type: "narration"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

interface CachedRun {
  scan: PreScan;
  ids: string[];
  verdicts: Verdict[];
  narration: string;
}

// ponytail: fixed demo EOA (anvil/hardhat's default account #0, pre-funded
// on every fork) rather than a wallet-derivation service — each probe still
// tops it up via fork.setBalanceEth in its own setup().
const TEST_WALLET: Hex = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

export interface Deps {
  withFork: typeof withFork;
  prescan: (fork: ForkClient, token: Hex) => Promise<PreScan>;
  planProbes: (scan: PreScan) => Promise<string[]>;
  narrate: (verdicts: Verdict[]) => Promise<string>;
  block: bigint;
  testWallet: Hex;
  getCached: typeof getCached;
  setCached: typeof setCached;
}

const defaultDeps: Deps = {
  withFork,
  prescan: realPrescan,
  planProbes: realPlanProbes,
  narrate: realNarrate,
  block: BASE_FORK_BLOCK,
  testWallet: TEST_WALLET,
  getCached,
  setCached,
};

export async function* runSidik(token: Hex, deps: Partial<Deps> = {}): AsyncGenerator<RunEvent> {
  const d: Deps = { ...defaultDeps, ...deps };
  try {
    const cached = d.getCached<CachedRun>(token, d.block);
    if (cached) {
      yield { type: "prescan", scan: cached.scan };
      yield { type: "plan", ids: cached.ids };
      for (const verdict of cached.verdicts) yield { type: "verdict", verdict };
      yield { type: "narration", text: cached.narration };
      yield { type: "done" };
      return;
    }

    const scan = await d.withFork(d.block, (fork) => d.prescan(fork, token));
    yield { type: "prescan", scan };

    const ids = await d.planProbes(scan);
    yield { type: "plan", ids };

    // ponytail: wallet-vs-token routing is already handled upstream by
    // prescan's isErc20 flag feeding planProbes/filterApplicable (approvalDrain
    // applies when !isErc20; honeypot/hiddenFee/lpRug when isErc20) — nothing
    // extra to route here, this loop just runs whatever plan already picked.
    const verdicts: Verdict[] = [];
    for (const id of ids) {
      yield { type: "probe:start", id };
      const verdict = await runProbe(d, token, scan, id);
      verdicts.push(verdict);
      yield { type: "verdict", verdict };
    }

    const text = await d.narrate(verdicts);
    yield { type: "narration", text };

    d.setCached(token, d.block, { scan, ids, verdicts, narration: text } satisfies CachedRun);
    yield { type: "done" };
  } catch (e) {
    yield { type: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

// ponytail: one fresh fork per probe — simple + isolated (no cross-probe
// state leakage); pool/reuse forks if per-run latency becomes a problem.
async function runProbe(d: Deps, token: Hex, scan: PreScan, id: string): Promise<Verdict> {
  const probe = PROBES.find((p) => p.id === id) as Probe | undefined;
  if (!probe) return naVerdict(id, `probe ${id} could not run — unknown probe id`);
  try {
    return await d.withFork(d.block, async (fork) => {
      const ctx: ProbeCtx = { token, scan, testWallet: d.testWallet, block: d.block };
      await probe.setup(fork, ctx);
      const raw = await probe.execute(fork, ctx);
      return probe.interpret(raw, ctx);
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return naVerdict(id, `probe ${id} could not run — ${msg}`);
  }
}

function naVerdict(id: string, title: string): Verdict {
  return { probe: id, status: "NA", title, rows: [], numbers: {}, txHashes: [] };
}

// A probe that threw never examined the token, so its NA says nothing about
// the token — only that the run broke. naVerdict is the only path that emits
// an NA with no rows, which makes emptiness the reliable tell. Callers that
// must not treat infrastructure failure as a finding (the fixture generator)
// use this.
export function isProbeFailure(v: Verdict): boolean {
  return v.status === "NA" && v.rows.length === 0;
}
