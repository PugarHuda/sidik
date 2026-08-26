import type { Hex, PreScan, Verdict, Probe, ForkClient, ProbeCtx, EngineEvent } from "@sidik/shared";
import { headlineOf } from "@sidik/shared";
import { withFork } from "./fork.js";
import { prescan as realPrescan } from "./prescan.js";
import { planProbes as realPlanProbes } from "./planner.js";
import { narrate as realNarrate } from "./narrator.js";
import { PROBES } from "./probes/registry.js";
import { BASE_FORK_BLOCK } from "./forkBlock.js";
import { ANVIL_ACCOUNT_0 } from "./base.js";
import { getCached, setCached } from "./cache.js";
import { log, since } from "./log.js";

// Defined in @sidik/shared so the page that renders these frames and the
// engine that emits them cannot drift apart. Re-exported under the name the
// engine has always used it by.
export type RunEvent = EngineEvent;

interface CachedRun {
  scan: PreScan;
  ids: string[];
  verdicts: Verdict[];
  narration: string;
}

// ponytail: fixed demo EOA (anvil's default account #0, pre-funded on every
// fork) rather than a wallet-derivation service — each probe still tops it up
// via fork.setBalanceEth in its own setup().
const TEST_WALLET: Hex = ANVIL_ACCOUNT_0;

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
  const started = performance.now();
  try {
    const cached = d.getCached<CachedRun>(token, d.block);
    if (cached) {
      log.info({ event: "run.cached", token, count: cached.verdicts.length, ms: since(started) });
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
    log.info({
      event: "run.done", token, count: verdicts.length, ms: since(started),
      status: headlineOf(verdicts),
    });
    yield { type: "done" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error({ event: "run.failed", token, ms: since(started), reason: message });
    yield { type: "error", message };
  }
}

// ponytail: one fresh fork per probe — simple + isolated (no cross-probe
// state leakage); pool/reuse forks if per-run latency becomes a problem.
async function runProbe(d: Deps, token: Hex, scan: PreScan, id: string): Promise<Verdict> {
  const probe = PROBES.find((p) => p.id === id) as Probe | undefined;
  if (!probe) return naVerdict(id, `probe ${id} could not run — unknown probe id`);
  const started = performance.now();
  try {
    const verdict = await d.withFork(d.block, async (fork) => {
      const ctx: ProbeCtx = { token, scan, testWallet: d.testWallet, block: d.block };
      await probe.setup(fork, ctx);
      const raw = await probe.execute(fork, ctx);
      return probe.interpret(raw, ctx);
    });
    log.info({ event: "probe.done", token, probe: id, status: verdict.status, ms: since(started) });
    return verdict;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Logged at error level, deliberately. This NA is the run breaking, not a
    // finding about the token, and from the outside the two look identical on
    // the page. Without this line there was no way to tell them apart at all.
    log.error({ event: "probe.failed", token, probe: id, ms: since(started), reason: msg });
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
