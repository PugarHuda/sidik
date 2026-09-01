import type { Hex, PreScan, Verdict, Probe, ForkClient, ProbeCtx, EngineEvent } from "@sidik/shared";
import { headlineOf } from "@sidik/shared";
import { openFork } from "./fork";
import { prescan as realPrescan } from "./prescan";
import { planProbes as realPlanProbes } from "./planner";
import { narrate as realNarrate } from "./narrator";
import { PROBES } from "./probes/registry";
import { BASE_FORK_BLOCK } from "./forkBlock";
import { ANVIL_ACCOUNT_0 } from "./base";
import { getCached, setCached } from "./cache";
import { log, since } from "./log";

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

// How long one run may take before the probes still queued are given up.
// A throttled gateway can hold a single receipt for minutes, and a run is
// fifteen or more sends; without a ceiling one such run held a concurrency
// slot for over an hour after its reader had gone. Checked between probes,
// so a probe already executing finishes and is recorded.
const RUN_BUDGET_MS = Number(process.env.SIDIK_RUN_BUDGET_MS ?? 10 * 60_000);

export interface Deps {
  openFork: typeof openFork;
  prescan: (fork: ForkClient, token: Hex) => Promise<PreScan>;
  planProbes: (scan: PreScan) => Promise<string[]>;
  narrate: (verdicts: Verdict[]) => Promise<string>;
  block: bigint;
  testWallet: Hex;
  getCached: typeof getCached;
  setCached: typeof setCached;
}

const defaultDeps: Deps = {
  openFork,
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
  let opened: Awaited<ReturnType<typeof openFork>> | undefined;
  try {
    const cached = d.getCached<CachedRun>(token, d.block);
    if (cached) {
      log.info({ event: "run.cached", token, count: cached.verdicts.length, ms: since(started) });
      // Also on the cached path. The cache is keyed by (token, block), so a
      // hit describes the block it was keyed with -- and a second run at the
      // head of the chain is served from cache, where a missing event would
      // have let the page fall back to the catalogue's block and print it
      // under a run taken 500,000 blocks later.
      yield { type: "forked", block: d.block.toString(), head: d.block !== BASE_FORK_BLOCK };
      yield { type: "prescan", scan: cached.scan };
      yield { type: "plan", ids: cached.ids };
      for (const verdict of cached.verdicts) yield { type: "verdict", verdict };
      yield { type: "narration", text: cached.narration };
      yield { type: "done" };
      return;
    }

    // ONE fork for the whole run. It used to be one per probe -- seven anvil
    // processes for a six-probe token -- which is simple and isolated but pays
    // a fork-and-replay of Base archive state every time, and on a loaded
    // machine is what makes process creation fail outright (Windows
    // 0xC0000142). Isolation now comes from a snapshot taken before each probe
    // and rolled back after it, which gives every probe the same pristine
    // state a fresh process did.
    opened = await d.openFork(d.block);
    // Before any probe, so the page can label the run even if a probe fails.
    yield { type: "forked", block: d.block.toString(), head: d.block !== BASE_FORK_BLOCK };
    const fork = opened.fork;

    const scan = await d.prescan(fork, token);
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
      if (performance.now() - started > RUN_BUDGET_MS) {
        // An NA with no rows: the shape isProbeFailure recognises, so the
        // generator never freezes a budget overrun as a verdict.
        log.error({ event: "probe.skipped", token, probe: id, ms: since(started), reason: "run budget exceeded" });
        const verdict = naVerdict(id, `probe ${id} could not run — the run exceeded its ${Math.round(RUN_BUDGET_MS / 60_000)}-minute budget`);
        verdicts.push(verdict);
        yield { type: "verdict", verdict };
        continue;
      }
      const verdict = await runProbe(d, fork, token, scan, id);
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
  } finally {
    // Including the cached path, which never opened one, and a consumer that
    // stops reading the stream half way: without this the anvil process would
    // outlive the run and the next one would compete with it for memory.
    opened?.close();
  }
}

/**
 * One probe, on the shared fork, against pristine state.
 *
 * The snapshot is taken before the probe and rolled back after it, so nothing
 * a probe does -- a buy, an impersonated rug pull, an owner minting ten times
 * the supply -- can reach the next one. anvil consumes a snapshot id when it
 * reverts to it, so the caller takes a fresh one for every probe.
 */
async function runProbe(d: Deps, fork: ForkClient, token: Hex, scan: PreScan, id: string): Promise<Verdict> {
  const probe = PROBES.find((p) => p.id === id) as Probe | undefined;
  if (!probe) return naVerdict(id, `probe ${id} could not run — unknown probe id`);
  const started = performance.now();
  let snapshot: string | undefined;
  try {
    snapshot = await fork.snapshot();
    const ctx: ProbeCtx = { token, scan, testWallet: d.testWallet, block: d.block };
    await probe.setup(fork, ctx);
    const raw = await probe.execute(fork, ctx);
    const verdict = probe.interpret(raw, ctx);
    log.info({ event: "probe.done", token, probe: id, status: verdict.status, ms: since(started) });
    return verdict;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Logged at error level, deliberately. This NA is the run breaking, not a
    // finding about the token, and from the outside the two look identical on
    // the page. Without this line there was no way to tell them apart at all.
    log.error({ event: "probe.failed", token, probe: id, ms: since(started), reason: msg });
    return naVerdict(id, `probe ${id} could not run — ${msg}`);
  } finally {
    // Node settings are not chain state, so the rollback below does not undo
    // an impersonation a probe left behind.
    try { await fork.clearImpersonations(); }
    catch { /* the rollback still matters more than this does */ }
    // Rolled back even when the probe threw. A probe that failed halfway has
    // left the chain in whatever state it got to, and handing that to the next
    // probe would produce a finding about this run rather than about the token.
    if (snapshot) {
      try { await fork.revertTo(snapshot); }
      catch (e) {
        log.error({ event: "probe.revertFailed", token, probe: id,
          reason: e instanceof Error ? e.message : String(e) });
      }
    }
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
