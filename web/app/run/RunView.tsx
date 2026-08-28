"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  EXAMPLES, FIXTURE_BLOCK, FIXTURE_META, headlineOf, impostorsOf, venueListings,
  type Recheck, type ScannerReadings, type Verdict, type Verification,
} from "@sidik/shared";
import { streamRunEvents, type RunEvent } from "@/lib/sse";

const TOKEN_RE = /^0x[0-9a-fA-F]{40}$/;

// Venue ids as recorded in listings.ts, spelled the way each venue spells itself.
const VENUE_NAME: Record<string, string> = { bingx: "BingX", gate: "Gate" };

type Ev<T extends RunEvent["type"]> = Extract<RunEvent, { type: T }>;

function formatAddr(a: string) {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/**
 * Full addresses in prose, shortened for the screen.
 *
 * The narration is a model's sentence and it prints whatever the run carried,
 * including a 42-character owner address. That one word measured 416px in a
 * 292px column, widened the whole document to 465px at a 390px viewport, and
 * shrank every tap target on the page by 16%. The full address is already in
 * the verdict's chips and in the JSON; the sentence needs only the handle.
 */
function shortenAddresses(text: string): string {
  return text.replace(/0x[0-9a-fA-F]{40}/g, (a) => formatAddr(a));
}

const TONE = {
  PASS: { text: "text-pass", border: "border-pass/40", bg: "bg-pass/15" },
  FAIL: { text: "text-fail", border: "border-fail/40", bg: "bg-fail/15" },
  NA: { text: "text-na", border: "border-na/40", bg: "bg-na/15" },
} as const;

// The order a case file reads in: what was found, then what held, then what
// could not be answered, then what never applied. The engine emits probes in
// the planner's order, which on DEGEN put a PASS first and the FAIL second —
// a reader who stopped at the first card left with the wrong answer.
const CARD_ORDER: Record<string, number> = { FAIL: 0, PASS: 1, NA: 2 };
function byImportance(a: Verdict, b: Verdict): number {
  const ra = a.applicable === false ? 3 : CARD_ORDER[a.status] ?? 2;
  const rb = b.applicable === false ? 3 : CARD_ORDER[b.status] ?? 2;
  return ra - rb;
}

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
function Badge({ status, applicable, size = "sm" }: { status: Verdict["status"]; applicable?: boolean; size?: "sm" | "lg" }) {
  const t = TONE[status];
  const dims = size === "lg"
    ? "px-5 py-2 text-2xl tracking-[0.15em]"
    : "px-3 py-1 text-xs tracking-widest";
  if (applicable === false) {
    return (
      <span className={`rounded-full border border-border font-mono font-semibold text-fg-dim ${dims}`}>
        DOES NOT APPLY
      </span>
    );
  }
  return (
    <span className={`rounded-full border font-mono font-semibold ${dims} ${t.text} ${t.border} ${t.bg}`}>
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
  const rawId = useId();
  const inapplicable = verdict.applicable === false;
  return (
    <div
      data-probe={verdict.probe}
      data-applicable={inapplicable ? "false" : "true"}
      className="animate-reveal overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <span className="font-mono text-xs text-fg-dim">{verdict.probe}</span>
        {/* A bare "FAIL" read aloud has no subject; the probe name is the subject. */}
        <span className="sr-only">{verdict.probe} verdict: </span>
        <Badge status={verdict.status} applicable={verdict.applicable} />
      </div>

      <div className="px-5 py-4">
        <h3 className="wrap-anywhere text-lg font-semibold text-fg">{verdict.title}</h3>
        {verdict.reason && <p className="wrap-anywhere mt-1 text-sm text-fg-dim">{verdict.reason}</p>}
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
                {/* Neutral when the probe does not apply. A red sentence on a
                    card stamped DOES NOT APPLY is the exact misreading that
                    stamp was invented to prevent. */}
                <dd className={`wrap-anywhere text-sm font-medium ${inapplicable ? "text-fg" : r.ok ? "text-pass" : "text-fail"}`}>
                  {r.proven}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {Object.keys(verdict.numbers).length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
          {Object.entries(verdict.numbers).map(([k, v]) => (
            <span key={k} className="wrap-anywhere rounded border border-border bg-ink px-2 py-1 font-mono text-xs text-fg-dim">
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
        aria-expanded={open}
        aria-controls={rawId}
        className="w-full border-t border-border px-5 py-3 text-left font-mono text-xs text-fg-dim transition hover:text-fg"
      >
        <span aria-hidden="true">{open ? "▾ " : "▸ "}</span>
        {open ? "Hide" : "Show"} raw verdict data
        <span className="sr-only"> for {verdict.probe}</span>
      </button>
      {open && (
        <pre id={rawId} className="overflow-x-auto border-t border-border bg-ink px-5 py-4 font-mono text-xs text-fg-dim">
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
/**
 * The OG card exists for shared links; this is the button that produces one.
 * Native share where the platform has it (every phone), clipboard elsewhere,
 * always the lower-case canonical URL so two people sharing the same run
 * share the same link.
 */
function ShareButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const url = () => `${location.origin}/run?token=${token.toLowerCase()}`;
  async function share() {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: document.title, url: url() });
        return;
      }
      await navigator.clipboard.writeText(url());
      setState("copied");
    } catch (e) {
      // AbortError is the user closing the share sheet; not a failure.
      if (e instanceof Error && e.name === "AbortError") return;
      setState("failed");
    }
  }
  return (
    <p className="mt-4 flex flex-wrap items-center gap-3 font-mono text-xs">
      <button
        type="button"
        onClick={share}
        className="rounded-md border border-border bg-ink px-3 py-1.5 text-fg transition hover:border-accent/60"
      >
        Share this verdict
      </button>
      {/* aria-live without role=status: the header pill is the page's one
          status region, and a second one made "the status" ambiguous. */}
      <span aria-live="polite" className="text-fg-dim">
        {state === "copied" ? "Link copied." : state === "failed" ? "Could not copy — the address bar has it." : ""}
      </span>
    </p>
  );
}

function ScannerReadout({ token, readings, verdicts, recheck }: { token: string; readings: ScannerReadings; verdicts: Verdict[]; recheck?: Recheck | null }) {
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
      <p className="text-fg">
        What read-only scanners say.{" "}
        <span className="text-fg-dim">
          Asked {readings.askedOn}, about the chain that day — not block {Number(FIXTURE_BLOCK).toLocaleString("en-US")}.
        </span>
      </p>
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
      {recheck && (
        // The one thing that separates "the token changed since the pin"
        // from "the scanner is wrong": the same sell, executed again at that
        // day's head. Still context — the verdict above is about the pin.
        <p className="mt-1" data-recheck={recheck.status}>
          Re-executed at head block {Number(recheck.headBlock).toLocaleString("en-US")} on {recheck.checkedOn}:{" "}
          <span className="text-fg">{recheck.status === "FAIL" ? "still could not sell" : recheck.status === "PASS" ? "still sold" : "could not answer"}</span>
          {" "}— {recheck.title}.
        </p>
      )}
      <p className="mt-2">
        Context only. No scanner flag changes a verdict above.{" "}
        <a href={`/api/token/${token}`} className="underline underline-offset-4 hover:text-fg">Same readings in the JSON.</a>
      </p>
    </div>
  );
}

/** The verdict word as it should be read: what it means for the person holding the token. */
function consequenceOf(verdicts: Verdict[], overall: Verdict["status"]): string {
  const failing = verdicts.filter((v) => v.status === "FAIL");
  if (failing.length === 1) return failing[0]!.title;
  if (failing.length > 1) return `${failing.length} probes found something: ${failing.map((v) => v.title).join(" · ")}`;
  if (overall === "PASS") return "Bought, sold, transferred and pulled against a fork of Base — every probe that could apply passed.";
  return "Not every probe could answer. Read the cards below before deciding anything.";
}

export default function RunView(
  { token, source, scanners, recheck }: { token: string; source?: Verification | null; scanners?: ScannerReadings | null; recheck?: Recheck | null },
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
      let settled = false;
      try {
        for await (const event of streamRunEvents(`/api/run?token=${token}`, controller.signal)) {
          if (event.type === "done" || event.type === "error") settled = true;
          setEvents((prev) => [...prev, event]);
        }
        // The connection closed cleanly with no verdict and no error: a
        // proxy timeout, a backgrounded phone tab, an engine restart. The
        // page used to sit on SCANNING forever, which reads as "still
        // working" on a run that will never finish.
        if (!settled && !controller.signal.aborted) {
          setEvents((prev) => [...prev, {
            type: "error",
            message: "The stream ended before the run finished. Reload to try again — a run the engine completed is answered from its cache in milliseconds.",
          }]);
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
        <p className="wrap-anywhere text-fg-dim">
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
  const ordered = [...verdicts].sort(byImportance);
  const narration = findLast("narration")?.text ?? null;
  const overall = headlineOf(verdicts);
  const planned = findLast("plan")?.ids.length ?? 0;
  const txCount = verdicts.reduce((n, v) => n + v.txHashes.length, 0);
  const block = Number(replay?.block ?? FIXTURE_BLOCK).toLocaleString("en-US");
  const symbol = prescan?.symbol || null;

  // Once the run is done the pill IS the verdict. It used to say DONE in
  // Cleared Green on a run whose verdict was FAIL — the top of the page
  // contradicting the bottom, in the colour that means "fine".
  const pill = isError
    ? { text: "ERROR", cls: `${TONE.FAIL.text} ${TONE.FAIL.border} ${TONE.FAIL.bg}` }
    : isDone && verdicts.length
      ? { text: overall, cls: `${TONE[overall].text} ${TONE[overall].border} ${TONE[overall].bg}` }
      : { text: planned ? `SCANNING ${verdicts.length}/${planned}` : "SCANNING", cls: "border-accent/40 bg-accent/15 text-accent" };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10 sm:py-12">
      <header className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link href="/" className="font-mono text-xs tracking-[0.3em] text-accent">
            SIDIK
          </Link>
          <h1 className="mt-2 flex flex-wrap items-baseline gap-x-3 font-mono">
            {symbol && <span className="text-2xl font-semibold text-fg">{symbol}</span>}
            {/* The token is real and on Base, unlike the fork transactions —
                so this is the one link here that leads somewhere. */}
            <a
              href={`https://basescan.org/address/${token}`}
              target="_blank"
              rel="noreferrer"
              className="text-base text-fg-dim hover:text-accent hover:underline"
            >
              {formatAddr(token)} ↗
            </a>
          </h1>
        </div>
        <span
          role="status"
          aria-live="polite"
          className={`w-fit rounded-full border px-3 py-1 font-mono text-xs font-semibold tracking-widest ${pill.cls}`}
        >
          {pill.text}
        </span>
      </header>

      {replay && (
        // Informational, so neutral. It used to be a three-line uppercase
        // amber banner — the NA colour, shouting, above the verdict.
        <p className="-mt-4 font-mono text-xs text-fg-dim">
          <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-na align-middle" aria-hidden="true" />
          Recorded run — real fork proof from block {replay.block}, replayed with no live engine
        </p>
      )}

      {isDone && verdicts.length > 0 && (
        <section
          aria-labelledby="verdict-heading"
          data-overall-verdict={overall}
          className={`animate-reveal rounded-xl border-2 bg-card p-6 ${TONE[overall].border}`}
        >
          <h2 id="verdict-heading" className="font-mono text-xs tracking-[0.3em] text-accent">SIDIK · VERDICT</h2>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Badge status={overall} size="lg" />
            <span className="font-mono text-xl font-semibold text-fg">{symbol ?? formatAddr(token)}</span>
          </div>
          <p className="wrap-anywhere mt-4 text-lg leading-7 text-fg">{consequenceOf(verdicts, overall)}</p>
          {prescan && !prescan.hasPool && prescan.otherVenues && prescan.otherVenues.length > 0 && (
            // Where the liquidity actually is when Uniswap has none. Read from
            // DEX Screener at scan time; nothing was executed there, so it
            // explains the N/A without becoming part of the verdict.
            <p className="mt-2 text-sm text-fg-dim" data-other-venues>
              Liquidity exists on{" "}
              {prescan.otherVenues.map((v, i, all) => (
                <span key={v.pair}>
                  {i > 0 && (i === all.length - 1 ? " and " : ", ")}
                  <span className="text-fg">{v.dex}</span>
                  {v.liquidityUsd > 0 ? ` (${v.liquidityUsd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })})` : ""}
                </span>
              ))}
              {" "}— venues Sidik does not trade on, so nothing was executed against it.
            </p>
          )}
          <p className="mt-2 font-mono text-xs text-fg-dim">
            Proven at block {block} — {txCount} fork {txCount === 1 ? "transaction" : "transactions"}, none broadcast.
            Not simulated, not inferred from bytecode.
          </p>
          <ShareButton token={token} />
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Verdict per probe">
            {ordered.map((v, i) => (
              <li
                key={`${v.probe}-${i}`}
                className={v.applicable === false
                  ? "rounded-full border border-border px-3 py-1 font-mono text-xs text-fg-dim"
                  : `rounded-full border px-3 py-1 font-mono text-xs ${TONE[v.status].text} ${TONE[v.status].border} ${TONE[v.status].bg}`}
              >
                {v.probe}: {v.applicable === false ? "n/a here" : v.status}
              </li>
            ))}
          </ul>
        </section>
      )}

      {isError && (
        <div className="animate-reveal rounded-lg border border-fail/50 bg-fail/10 px-6 py-5">
          <h2 className="font-mono text-xs uppercase tracking-widest text-fail">Run failed</h2>
          {/* Two sentences: the plain one first, the exact one second. The
              API's message is precise and is what the tests and the JSON
              carry; a person on a phone needs the first sentence. */}
          <p className="mt-2 text-base text-fg">
            Sidik has not traded this token yet. It only shows results for addresses it actually bought and sold on a fork.
          </p>
          <p className="wrap-anywhere mt-1 text-sm text-fg-dim">{errorEvent?.message}</p>
          <div className="mt-4">
            <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-fg-dim">Open a recorded run instead</div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <Link
                  key={ex.address}
                  href={`/run?token=${ex.address}`}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm text-fg transition hover:border-accent/60"
                >
                  {ex.label}
                </Link>
              ))}
              <Link
                href="/catalogue"
                className="rounded-md border border-border px-3 py-2 font-mono text-sm text-accent transition hover:border-accent/60"
              >
                Browse every recorded run →
              </Link>
            </div>
          </div>
          {/* The engine that probes new addresses is in the repository. Kept,
              because it is real; folded, because it is for a developer at a
              keyboard and this block is read on phones. */}
          <details className="mt-4 text-xs text-fg-dim">
            <summary className="cursor-pointer font-mono hover:text-fg">Probe it yourself (developers)</summary>
            <p className="mt-2">The engine forks Base once per run:</p>
            <code
              tabIndex={0}
              role="group"
              aria-label="Command to probe this address locally"
              className="mt-1 block overflow-x-auto whitespace-nowrap rounded border border-border bg-ink px-1.5 py-1 text-fg outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              pnpm dev:engine &amp;&amp; curl &quot;localhost:8787/run?token={token}&quot;
            </code>
          </details>
        </div>
      )}

      {verdicts.length > 0 && (
        <section aria-labelledby="exhibits-heading" className="flex flex-col gap-6">
          <h2 id="exhibits-heading" className="font-mono text-xs uppercase tracking-[0.2em] text-fg-dim">
            Exhibits — one card per probe{isRunning ? ", arriving as they run" : ""}
          </h2>
          {(isDone ? ordered : verdicts).map((v, i) => (
            <VerdictCard key={`${v.probe}-${i}`} verdict={v} />
          ))}
        </section>
      )}

      {narration && (
        <section aria-labelledby="narration-heading" className="animate-reveal rounded-lg border border-accent/30 bg-panel px-6 py-5">
          <h2 id="narration-heading" className="mb-2 font-mono text-xs uppercase tracking-widest text-accent">
            Narration — written by a model, from the verdicts above
          </h2>
          <p className="wrap-anywhere text-base leading-7 text-fg">{shortenAddresses(narration)}</p>
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
        </section>
      )}

      <section aria-labelledby="trace-heading" className="rounded-md border border-border bg-panel p-4 font-mono text-sm">
        <h2 id="trace-heading" className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-fg-dim">
          {isRunning && <span className="h-2 w-2 rounded-full bg-accent animate-recording" aria-hidden="true" />}
          live trace
          {traceEvents.length > 0 && (
            <span className="ml-auto normal-case tracking-normal">{traceEvents.length} lines{traceEvents.length > 10 ? " · scrolls" : ""}</span>
          )}
        </h2>
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
              className={`wrap-anywhere animate-reveal ${e.type === "error" ? "text-fail" : "text-fg-dim"}`}
            >
              {logLine(e)}
            </div>
          ))}
        </div>
      </section>

      {isDone && verdicts.length > 0 && (
        <section aria-labelledby="check-heading" className="rounded-lg border border-border bg-card px-5 py-4 text-xs text-fg-dim">
          <h2 id="check-heading" className="font-mono text-xs uppercase tracking-[0.2em] text-fg-dim">Check it yourself</h2>
          {/* The site serves recorded runs, and "these are real runs, not mock
              data" is a claim a reader has no way to check. This is how they
              check it: same command, same block, their own RPC. Printed here
              rather than buried in the README because the claim is made here. */}
          <p className="mt-2">
            Do not take our word for it — re-run this address yourself. This forks Base at the
            same block and tells you whether it gets the same verdict:
          </p>
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
          {FIXTURE_META.engineCommit && (
            <p className="mt-1 font-mono text-xs">
              Catalogue recorded through {FIXTURE_META.recordedThrough} at commit{" "}
              <a
                href={`https://github.com/PugarHuda/sidik/commit/${FIXTURE_META.engineCommit}`}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-4 hover:text-fg"
              >
                {FIXTURE_META.engineCommit.slice(0, 7)}
              </a>
              {FIXTURE_META.anvil ? <> with {FIXTURE_META.anvil}</> : null}.
            </p>
          )}
          <p className="mt-2">
            Or read it as JSON:{" "}
            <a href={`/api/token/${token}`} className="underline underline-offset-4 hover:text-fg">
              /api/token/{formatAddr(token)}
            </a>
          </p>

          {/* Corroboration, deliberately outside the verdict. A token you
              cannot sell cannot sustain a market on an independent venue, so a
              listing supports a PASS — and would be alarming next to a FAIL.
              It is never evidence: the verdict comes from the fork alone. */}
          <h2 className="mt-5 font-mono text-xs uppercase tracking-[0.2em] text-fg-dim">Context, never evidence</h2>
          {impostorsOf(token).length > 0 && (
            <p className="mt-2 text-na">
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
            </p>
          )}
          {venueListings(token).length > 0 && (
            <p className="mt-2">
              Also trades on{" "}
              {venueListings(token).map((l, i, all) => (
                <span key={l.venue}>
                  {i > 0 && (i === all.length - 1 ? " and " : ", ")}
                  <span className="text-fg">{VENUE_NAME[l.venue]}</span> as{" "}
                  <span className="text-fg">{l.ticker}</span>
                </span>
              ))}
              {" "}— {venueListings(token).length === 1 ? "an independent venue" : "independent venues"}.
              Context only; it is not part of the proof.
            </p>
          )}
          {/* The advice everyone gives is "check that the contract is
              verified". Across this catalogue that advice separates almost
              nothing: 46 of the 47 addresses with a finding against them
              publish verified source. Stated per token so a reader can see it
              on the one in front of them rather than take the aggregate on
              trust. Read from Blockscout, and no part of any verdict. */}
          {source && (
            <p className="mt-2">
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
            </p>
          )}
          {scanners && <ScannerReadout token={token} readings={scanners} verdicts={verdicts} recheck={recheck} />}
        </section>
      )}
    </div>
  );
}
