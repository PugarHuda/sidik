"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CatalogueRow } from "@/lib/catalogue";

const TONE: Record<string, string> = {
  PASS: "text-pass border-pass/40 bg-pass/10",
  FAIL: "text-fail border-fail/40 bg-fail/10",
  NA: "text-na border-na/40 bg-na/10",
};

type Filter = "all" | "failing" | "honeypot" | "hiddenFee" | "lpRug";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "failing", label: "Anything failed" },
  { id: "honeypot", label: "Honeypots" },
  { id: "hiddenFee", label: "Hidden fees" },
  { id: "lpRug", label: "LP rugs" },
];

export default function CatalogueTable({ rows }: { rows: CatalogueRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "failing" && r.headline !== "FAIL") return false;
      if (filter !== "all" && filter !== "failing"
        && !r.probes.some((p) => p.id === filter && p.status === "FAIL")) return false;
      if (!q) return true;
      return r.symbol.toLowerCase().includes(q) || r.address.toLowerCase().includes(q);
    });
  }, [rows, filter, query]);

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`rounded-md border px-3 py-1.5 font-mono text-xs transition ${
                filter === f.id
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-fg-dim hover:text-fg"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label htmlFor="catalogue-search" className="sr-only">Filter by symbol or address</label>
        <input
          id="catalogue-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="symbol or address…"
          spellCheck={false}
          className="w-full rounded-md border border-border bg-panel px-3 py-1.5 font-mono text-xs text-fg placeholder:text-fg-dim/60 outline-none focus:border-accent sm:ml-auto sm:w-64"
        />
      </div>

      <div className="mb-3 font-mono text-xs text-fg-dim" aria-live="polite">
        {shown.length} of {rows.length} recorded runs
      </div>

      <ul className="flex flex-col gap-2">
        {shown.map((r) => (
          <li key={r.address}>
            <Link
              href={`/run?token=${r.address}`}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 transition hover:border-accent/50 sm:flex-row sm:items-center"
            >
              <span className={`w-fit rounded border px-2 py-0.5 font-mono text-xs ${TONE[r.headline]}`}>
                {r.headline}
              </span>
              <span className="font-mono text-sm text-fg">{r.symbol}</span>
              {r.venue && (
                <span className="font-mono text-[11px] uppercase tracking-wider text-fg-dim">
                  {r.venue}
                </span>
              )}
              {r.listedAs && (
                <span className="font-mono text-[11px] text-fg-dim">BingX</span>
              )}
              {r.sharesSymbolWith > 0 && (
                <span
                  className="w-fit rounded border border-na/40 bg-na/10 px-2 py-0.5 font-mono text-[11px] text-na"
                  title="Other recorded Base tokens use this same symbol, and their verdicts are not the same"
                >
                  +{r.sharesSymbolWith} sharing this symbol
                </span>
              )}
              <span className="text-sm text-fg-dim sm:ml-2 sm:flex-1">{r.finding}</span>
              <span className="font-mono text-[11px] text-fg-dim">
                {r.address.slice(0, 6)}…{r.address.slice(-4)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {shown.length === 0 && (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-fg-dim">
          Nothing recorded matches that. Every run in here was executed against a
          fork; there is no entry for an address Sidik has not actually traded.
        </p>
      )}
    </div>
  );
}
