"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { headlineOf, impostorsOf, venueListings, type ScannerReadings, type Verdict, type Verification } from "@sidik/shared";
import { streamRunEvents, type RunEvent } from "@/lib/sse";

const TOKEN_RE = /^0x[0-9a-fA-F]{40}$/;

// Venue ids as recorded in listings.ts, spelled the way each venue spells itself.
const VENUE_NAME: Record<string, string> = { bingx: "BingX", gate: "Gate" };

type Ev<T extends RunEvent["type"]> = Extract<RunEvent, { type: T }>;

function formatAddr(a: string) {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

const TONE = {
  PASS: { text: "text-pass", border: "border-pass/40", bg: "bg-pass/15" },
  FAIL: { text: "text-fail", border: "border-fail/40", bg: "bg-fail/15" },
  NA: { text: "text-na", border: "border-na/40", bg: "bg-na/15" },
} as const;

/**
 * A probe whose mechanism does not exist for this token reads as N/A, which
 * is indistinguishable from "we tried and could not tell".
 *
 * That distinction used to be invisible and cost little, because only one
 * probe was ever inapplicable. With the owner-switch probe it is the common
 * case — 161 of the recorded addresses carry no switch at all — so a clean
 * token would show two N/A cards among six and read as poorly covered when
 * every check that could apply had answered.
 */
function Badge({ status, applicable }: { status: Verdict["status"]; applicable?: boolean }) {
  const t = TONE[status];
  if (applicable === false) {
    return (
      <span className="rounded-full border border-border px-3 py-1 font-mono text-xs font-semibold tracking-widest text-fg-dim">
        DOES NOT APPLY
      </span>
    );
  }
  return (
    <span
      className={`rounded-full border px-3 py-1 font-mono text-xs font-semibold tracking-widest ${t.text} ${t.border} ${t.bg}`}
    >
      {status}
    </span>
  );
}

function logLine(e: RunEvent): string {
  switch (e.type) {
    case "prescan":
      return `PRESCAN   symbol=${e.scan.symbol} decimals=${e.scan.decimals} pool=${e.scan.hasPool ? "yes" : "no"} erc20=${e.scan.isErc20 ? "yes" : "no"}`;
    case "plan":
      return `PLAN      probes=[${e.ids.join(", ")}]`;
    case "probe:start":
      return `PROBE     running ${e.id}…`;
    case "verdict":
      return `VERDICT   ${e.verdict.probe} → ${e.verdict.status}`;
    case "narration":
      return `NARRATE   summary ready`;
    case "done":
      return `DONE      run complete`;
    case "error":
      return `ERROR     ${e.message}`;
    case "replay":
      return `REPLAY    recorded fork run at block ${e.block} — no live engine`;
  }
}

function VerdictCard({ verdict }: { verdict: Verdict }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="animate-reveal overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <span className="font-mono text-xs text-fg-dim">{verdict.probe}</span>
        <Badge status={verdict.status} applicable={verdict.applicable} />
      </div>

      <div className="px-5 py-4">
        <h3 className="text-lg font-semibold text-fg">{verdict.title}</h3>
        {verdict.reason && <p className="mt-1 text-sm text-fg-dim">{verdict.reason}</p>}
      </div>

      <div className="grid grid-cols-1 divide-y divide-border border-t border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="px-5 py-4">
          {/* Not "claimed": nothing here is quoted from the project. Sidik
              never reads a token's site, docs or metadata. This column is the
              default any listed ERC-20 implies simply by being tradable, and
              labelling it as the token's own claim would be putting words in
              its mouth — in the one product that must not do that. */}
          <div className="mb-3 font-mono text-xs uppercase tracking-widest text-fg-dim">
            What a buyer assumes
          </div>
          <dl className="flex flex-col gap-3">
            {verdict.rows.map((r, i) => (
              <div key={i}>
                <dt className="text-xs text-fg-dim">{r.label}</dt>
                <dd className="text-sm text-fg">{r.claimed}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="px-5 py-4">
          <div className="mb-3 font-mono text-xs uppercase tracking-widest text-fg-dim">
            Proven in fork
          </div>
          <dl className="flex flex-col gap-3">
            {verdict.rows.map((r, i) => (
              <div key={i}>
                <dt className="text-xs text-fg-dim">{r.label}</dt>
                <dd className={`text-sm font-medium ${r.ok ? "text-pass" : "text-fail"}`}>{r.proven}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {Object.keys(verdict.numbers).length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
          {Object.entries(verdict.numbers).map(([k, v]) => (
            <span key={k} className="rounded border border-border bg-ink px-2 py-1 font-mono text-xs text-fg-dim">
              {k}: <span className="text-fg">{v}</span>
            </span>
          ))}
        </div>
      )}

      {verdict.txHashes.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3 font-mono text-xs">
          {/* Deliberately not a link. These transactions were mined on a fork
              and never broadcast, so a block-explorer URL for them is a page
              that cannot exist — and sending someone to an empty explorer
              page to check our proof is worse than showing none. The hash is
              the handle for the raw data below it. */}
          {verdict.txHashes.map((h) => (
            <span key={h} className="text-fg" title={h}>
              {h.slice(0, 10)}…{h.slice(-6)}
            </span>
          ))}
          <span className="text-fg-dim">
            fork tx — mined on a forked chain, never broadcast, so not on any explorer
          </span>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full border-t border-border px-5 py-3 text-left font-mono text-xs text-fg-dim transition hover:text-fg"
      >
        {open ? "▾ hide raw verdict data" : "▸ show raw verdict data"}
      </button>
      {open && (
        <pre className="overflow-x-auto border-t border-border bg-ink px-5 py-4 font-mono text-xs text-fg-dim">
          {JSON.stringify(verdict, null, 2)}
        </pre>
      )}
    </div>
  );
}

/**
 * What two read-only scanners say about this address, beside what execution
 * found. GoPlus is the check most wallets embed; honeypot.is runs a
 * simulation of its own. Neither is evidence here and neither changes a
 * verdict — this exists because "could a scanner not have told me this?" is
 * the question a reader asks next, and the honest answer is per address:
 * sometimes yes, sometimes no, and the disagreements run both ways.
 *
 * They describe the chain on the day they were asked, not the fork block
 * every verdict describes. That gap is printed rather than papered over.
 */
function ScannerReadout({ token, readings, verdicts }: { token: string; readings: ScannerReadings; verdicts: Verdict[] }) {
  const hp = verdicts.find((v) => v.probe === "honeypot");
  const sidikHoneypot = hp?.status === "FAIL";
  const g = readings.goplus;
  const h = readings.honeypotIs;
  const yes = (f: boolean | undefined) => (f === undefined ? "no answer" : f ? "yes" : "no");
  const pct = (n: number | undefined) => (n === undefined ? "no answer" : `${n}%`);

  // Only called a disagreement when the verdict in question actually ran.
  const disagree: string[] = [];
  if (hp && hp.status !== "NA") {
    if (g?.isHoneypot !== undefined && g.isHoneypot !== sidikHoneypot) {
      disagree.push(`GoPlus says ${g.isHoneypot ? "honeypot" : "not a honeypot"}; the fork ${sidikHoneypot ? "could not sell" : "sold"}`);
    }
    if (h && h.isHoneypot !== sidikHoneypot) {
      disagree.push(`honeypot.is says ${h.isHoneypot ? "honeypot" : "not a honeypot"}; the fork ${sidikHoneypot ? "could not sell" : "sold"}`);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-ink/60 px-3 py-2 text-xs text-fg-dim">
      <div className="font-mono text-[11px] uppercase tracking-widest">
        What read-only scanners say — asked {readings.askedOn}, about the chain that day, not block 50,200,000
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {g && (
          <div>
            <dt className="text-fg">GoPlus</dt>
            <dd>
              honeypot: <span className="text-fg">{yes(g.isHoneypot)}</span> · buy tax{" "}
              <span className="text-fg">{pct(g.buyTaxPct)}</span> · sell tax{" "}
              <span className="text-fg">{pct(g.sellTaxPct)}</span> · pausable{" "}
              <span className="text-fg">{yes(g.transferPausable)}</span> · blacklist{" "}
              <span className="text-fg">{yes(g.isBlacklisted)}</span> · mintable{" "}
              <span className="text-fg">{yes(g.isMintable)}</span>
            </dd>
          </div>
        )}
        {h && (
          <div>
            <dt className="text-fg">honeypot.is</dt>
            <dd>
              honeypot: <span className="text-fg">{h.isHoneypot ? "yes" : "no"}</span> · risk{" "}
              <span className="text-fg">{h.risk}</span> · buy tax{" "}
              <span className="text-fg">{pct(h.buyTaxPct)}</span> · sell tax{" "}
              <span className="text-fg">{pct(h.sellTaxPct)}</span>
              {h.flags.length > 0 && <> · flags: <span className="text-fg">{h.flags.join(", ")}</span></>}
            </dd>
          </div>
        )}
      </dl>
      {disagree.length > 0 && (
        <p className="mt-2 text-na" data-scanner-disagreement>
          Disagrees with what was executed: {disagree.join("; ")}.
        </p>
      )}
      <p className="mt-2">
        Context only. No scanner flag changes a verdict above.{" "}
        <a href={`/api/token/${token}`} className="underline underline-offset-4 hover:text-fg">Same readings in the JSON.</a>
      </p>
    </div>
  );
}

export default function RunView(
  { token, source, scanners }: { token: string; source?: Verification | null; scanners?: ScannerReadings | null },
) {
  const tokenValid = TOKEN_RE.test(token);
  const [events, setEvents] = useState<RunEvent[]>([]);

  useEffect(() => {
    if (!tokenValid) return;
    // ponytail: no setEvents([]) reset here — the parent keys this component
    // by token (see run/page.tsx), so a token change remounts fresh rather
    // than reusing state, which avoids a synchronous setState-in-effect.
    const controller = new AbortController();

    (async () => {
      try {
        for await (const event of streamRunEvents(`/api/run?token=${token}`, controller.signal)) {
          setEvents((prev) => [...prev, event]);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        const message = e instanceof Error ? e.message : String(e);
        setEvents((prev) => [...prev, { type: "error", message }]);
      }
    })();

    return () => controller.abort();
  }, [token, tokenValid]);

  if (!tokenValid) {
    return (
      <div className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="font-mono text-xs uppercase tracking-widest text-fail">Invalid address</div>
        {/* Same sentence the API returns for the same condition. The client
            short-circuits before calling it, so without this the product had
            two different ways of saying one thing depending on how you
            arrived. */}
        <p className="text-fg-dim">
          &quot;{token || "(empty)"}&quot; is not a Base address — expected 0x followed by 40 hex characters.
        </p>
        <Link href="/" className="font-mono text-sm text-accent hover:underline">
          ← back to Sidik
        </Link>
      </div>
    );
  }

  const errorEvent = events.find((e): e is Ev<"error"> => e.type === "error");
  const isDone = events.some((e) => e.type === "done") && !errorEvent;
  const isError = !!errorEvent;
  const isRunning = !isDone && !isError;
  const replay = events.find((e) => e.type === "replay");
  const traceEvents = events.filter((e) => e.type !== "replay");

  const findLast = <T extends RunEvent["type"]>(t: T): Ev<T> | undefined => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e?.type === t) return e as Ev<T>;
    }
    return undefined;
  };

  const prescan = findLast("prescan")?.scan ?? null;
  const verdicts = events.filter((e): e is Ev<"verdict"> => e.type === "verdict").map((e) => e.verdict);
  const narration = findLast("narration")?.text ?? null;
  const overall = headlineOf(verdicts);
  const planned = findLast("plan")?.ids.length ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/" className="font-mono text-xs tracking-[0.3em] text-accent">
            SIDIK
          </Link>
          <div className="mt-1 font-mono text-lg text-fg">{formatAddr(token)}</div>
        </div>
        <span
          className={`w-fit rounded-full border px-3 py-1 font-mono text-xs font-semibold tracking-widest ${
            isError
              ? `${TONE.FAIL.text} ${TONE.FAIL.border} ${TONE.FAIL.bg}`
              : isDone
                ? `${TONE.PASS.text} ${TONE.PASS.border} ${TONE.PASS.bg}`
                : "border-accent/40 bg-accent/15 text-accent"
          }`}
        >
          {/* How far through, once the plan says how many there are. A run is
              six probes now and each spends real seconds inside a fork; a bare
              "SCANNING" gives a reader no way to tell a run that is working
              from one that has stalled. */}
          {isError ? "ERROR" : isDone ? "DONE" : planned ? `SCANNING ${verdicts.length}/${planned}` : "SCANNING"}
        </span>
      </div>

      {replay && (
        <div className="animate-reveal rounded-md border border-na/50 bg-na/10 px-4 py-2.5 text-center font-mono text-xs font-semibold uppercase tracking-widest text-na">
          Recorded run — real fork proof from block {replay.block}, replayed with no live engine
        </div>
      )}

      <div className="rounded-md border border-border bg-panel p-4 font-mono text-sm">
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-fg-dim">
          {isRunning && <span className="h-2 w-2 rounded-full bg-accent animate-recording" />}
          live trace
        </div>
        {/* Focusable on purpose. At desktop width the trace fits and this is
            an ordinary block; at phone width it overflows and becomes a
            scroll region, which a keyboard or switch user then cannot reach
            or scroll at all. axe caught it only on the mobile viewports —
            desktop-only testing would never have shown it. The group role and
            label give it a name once it takes focus. */}
        <div
          tabIndex={0}
          role="group"
          aria-label="Live trace log"
          className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          {traceEvents.length === 0 && <div className="text-fg-dim">connecting…</div>}
          {traceEvents.map((e, i) => (
            <div
              key={i}
              className={`animate-reveal ${e.type === "error" ? "text-fail" : "text-fg-dim"}`}
            >
              {logLine(e)}
            </div>
          ))}
        </div>
      </div>

      {isError && (
        <div className="animate-reveal rounded-lg border border-fail/50 bg-fail/10 px-6 py-5">
          <div className="font-mono text-xs uppercase tracking-widest text-fail">Run failed</div>
          <p className="mt-1 text-sm text-fg">{errorEvent?.message}</p>
          {/* An error that only says no was the whole of this page. Both routes
              out of it are real and neither invents a verdict: the catalogue
              may already hold this address, and the engine that probes new
              ones is in the repo and runs on one anvil per token. */}
          <div className="mt-3 flex flex-col gap-2 text-xs text-fg-dim">
            <div>
              <a
                href={`/catalogue?q=${encodeURIComponent(token)}`}
                className="text-accent underline underline-offset-4"
              >
                Search the catalogue for this address
              </a>{" "}
              — it may be recorded under a run this page could not reach.
            </div>
            <div>
              Or probe it yourself. The engine is in the repository and forks Base once per run:
              <code
                tabIndex={0}
                role="group"
                aria-label="Command to probe this address locally"
                className="mt-1 block overflow-x-auto whitespace-nowrap rounded border border-border bg-ink px-1.5 py-1 text-fg outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                pnpm dev:engine &amp;&amp; curl &quot;localhost:8787/run?token={token}&quot;
              </code>
            </div>
          </div>
        </div>
      )}

      {verdicts.length > 0 && (
        <div className="flex flex-col gap-6">
          {verdicts.map((v, i) => (
            <VerdictCard key={`${v.probe}-${i}`} verdict={v} />
          ))}
        </div>
      )}

      {narration && (
        <div className="animate-reveal rounded-lg border border-accent/30 bg-panel px-6 py-5">
          <div className="mb-2 font-mono text-xs uppercase tracking-widest text-accent">
            Narration — written by a model, from the verdicts above
          </div>
          <p className="text-base leading-7 text-fg">{narration}</p>
          {/* This is the only prose on the page, so it is the paragraph a
              reader is most likely to take as the product. Unlabelled, it
              invites exactly the assumption this project exists to refute —
              that a model decided any of it. Both guarantees named here are
              real and enforced in engine/src/narrator.ts and
              shared/src/narration.ts. */}
          <p className="mt-3 text-xs leading-5 text-fg-dim">
            Every figure and transaction hash in it is checked against the run before it is
            shown, and a summary that contradicts a verdict is replaced by a deterministic one.
            The verdicts themselves are decided by code reading what a transaction did — never
            by the model.
          </p>
        </div>
      )}

      {isDone && verdicts.length > 0 && (
        <div className={`animate-reveal rounded-xl border-2 p-6 ${TONE[overall].border} bg-card`}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs tracking-[0.3em] text-accent">SIDIK · VERDICT</span>
            <Badge status={overall} />
          </div>
          <div className="mt-3 font-mono text-2xl font-semibold text-fg">
            {prescan?.symbol ?? "TOKEN"}{" "}
            {/* The token is real and on Base, unlike the fork transactions —
                so this is the one link here that leads somewhere. */}
            <a
              href={`https://basescan.org/address/${token}`}
              target="_blank"
              rel="noreferrer"
              className="text-base font-normal text-fg-dim hover:text-accent hover:underline"
            >
              {formatAddr(token)} ↗
            </a>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {verdicts.map((v, i) => (
              <span
                key={`${v.probe}-${i}`}
                className={v.applicable === false
                  ? "rounded-full border border-border px-3 py-1 font-mono text-xs text-fg-dim"
                  : `rounded-full border px-3 py-1 font-mono text-xs ${TONE[v.status].text} ${TONE[v.status].border} ${TONE[v.status].bg}`}
              >
                {v.probe}: {v.applicable === false ? "n/a here" : v.status}
              </span>
            ))}
          </div>
          <div className="mt-4 text-xs text-fg-dim">
            Proven against a forked Base state — not simulated, not inferred from bytecode.
          </div>
          {/* The site serves recorded runs, and "these are real runs, not mock
              data" is a claim a reader has no way to check. This is how they
              check it: same command, same block, their own RPC. Printed here
              rather than buried in the README because the claim is made here. */}
          <div className="mt-2 text-xs text-fg-dim">
            Do not take our word for it — re-run this address yourself. This forks Base at the
            same block and tells you whether it gets the same verdict:
            {/* The command is longer than a phone is wide, so it becomes a
                scroll region — and a scroll region with no way in is
                unreachable by keyboard or switch. Same group/label/tabIndex
                treatment the live trace log needed for exactly this reason. */}
            <code
              tabIndex={0}
              role="group"
              aria-label="Command to reproduce this run"
              className="mt-1 block overflow-x-auto whitespace-nowrap rounded border border-border bg-ink px-1.5 py-1 text-fg outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              pnpm --filter @sidik/engine reproduce {token}
            </code>
          </div>
          <div className="mt-2 text-xs text-fg-dim">
            Or read it as JSON:{" "}
            <a
              href={`/api/token/${token}`}
              className="underline underline-offset-4 hover:text-fg"
            >
              /api/token/{formatAddr(token)}
            </a>
          </div>
          {/* Corroboration, deliberately kept out of the verdict. A token you
              cannot sell cannot sustain a market on an independent venue, so a
              listing supports a PASS — and would be alarming next to a FAIL.
              It is never evidence: the verdict comes from the fork alone.
              Matched by hand, because exchange tickers collide. */}
          {impostorsOf(token).length > 0 && (
            <div className="mt-2 text-xs text-na">
              {/* Copycat tokens are a live scam on Base, and their verdicts
                  differ — one MOCHI fails its fee probe while the other
                  passes. A reader who found this by ticker needs telling. */}
              {impostorsOf(token).length} other recorded Base{" "}
              {impostorsOf(token).length === 1 ? "token uses" : "tokens use"} this same symbol,
              and they did not all behave the same way.{" "}
              <a href="/catalogue" className="underline underline-offset-4 hover:text-fg">
                Compare them
              </a>
              .
            </div>
          )}
          {venueListings(token).length > 0 && (
            <div className="mt-2 text-xs text-fg-dim">
              Also trades on{" "}
              {venueListings(token).map((l, i, all) => (
                <span key={l.venue}>
                  {i > 0 && (i === all.length - 1 ? " and " : ", ")}
                  <span className="text-fg">{VENUE_NAME[l.venue]}</span> as{" "}
                  <span className="text-fg">{l.ticker}</span>
                </span>
              ))}
              {" "}— {venueListings(token).length === 1 ? "an independent venue" : "independent venues"}.
              Corroboration only; it is not part of the proof.
            </div>
          )}
          {/* The advice everyone gives is "check that the contract is
              verified". Across this catalogue that advice separates almost
              nothing: 46 of the 47 addresses with a finding against them
              publish verified source. Stated per token so a reader can see it
              on the one in front of them rather than take the aggregate on
              trust. Read from Blockscout, and no part of any verdict. */}
          {source && (
            <div className="mt-2 text-xs text-fg-dim">
              {source.verified ? (
                <>
                  Source code is published and verified on{" "}
                  <a
                    href={`https://base.blockscout.com/address/${token}?tab=contract`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline underline-offset-4 hover:text-fg"
                  >
                    Blockscout
                  </a>
                  {source.name ? <> as <span className="text-fg">{source.name}</span></> : null}
                  {source.compiler ? <> (solc {source.compiler})</> : null}. Anyone could read it
                  before buying; every verdict above came from running it instead.
                </>
              ) : (
                <>No verified source code is published for this address on Blockscout.</>
              )}
            </div>
          )}
          {scanners && <ScannerReadout token={token} readings={scanners} verdicts={verdicts} />}
        </div>
      )}
    </div>
  );
}
