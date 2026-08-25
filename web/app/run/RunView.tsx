"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Verdict } from "@sidik/shared";
import { streamRunEvents, type RunEvent } from "@/lib/sse";

const TOKEN_RE = /^0x[0-9a-fA-F]{40}$/;

type Ev<T extends RunEvent["type"]> = Extract<RunEvent, { type: T }>;

function formatAddr(a: string) {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function overallStatus(verdicts: Verdict[]): Verdict["status"] {
  if (verdicts.length === 0) return "NA";
  if (verdicts.some((v) => v.status === "FAIL")) return "FAIL";
  if (verdicts.some((v) => v.status === "NA")) return "NA";
  return "PASS";
}

const TONE = {
  PASS: { text: "text-pass", border: "border-pass/40", bg: "bg-pass/15" },
  FAIL: { text: "text-fail", border: "border-fail/40", bg: "bg-fail/15" },
  NA: { text: "text-na", border: "border-na/40", bg: "bg-na/15" },
} as const;

function Badge({ status }: { status: Verdict["status"] }) {
  const t = TONE[status];
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
        <Badge status={verdict.status} />
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

export default function RunView({ token }: { token: string }) {
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
        <div className="font-mono text-xs uppercase tracking-widest text-fail">Invalid token</div>
        <p className="text-fg-dim">&quot;{token || "(empty)"}&quot; isn&apos;t a 0x-prefixed 40-hex-char address.</p>
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
      if (events[i].type === t) return events[i] as Ev<T>;
    }
    return undefined;
  };

  const prescan = findLast("prescan")?.scan ?? null;
  const verdicts = events.filter((e): e is Ev<"verdict"> => e.type === "verdict").map((e) => e.verdict);
  const narration = findLast("narration")?.text ?? null;
  const overall = overallStatus(verdicts);

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
          {isError ? "ERROR" : isDone ? "DONE" : "SCANNING"}
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
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
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
          <div className="mb-2 font-mono text-xs uppercase tracking-widest text-accent">Narration</div>
          <p className="text-base leading-7 text-fg">{narration}</p>
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
                className={`rounded-full border px-3 py-1 font-mono text-xs ${TONE[v.status].text} ${TONE[v.status].border} ${TONE[v.status].bg}`}
              >
                {v.probe}: {v.status}
              </span>
            ))}
          </div>
          <div className="mt-4 text-xs text-fg-dim">
            Proven against a forked Base state — not simulated, not inferred from bytecode.
          </div>
        </div>
      )}
    </div>
  );
}
