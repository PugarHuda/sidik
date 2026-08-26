import Link from "next/link";
import type { CatalogueRow } from "@sidik/shared";

const TONE: Record<string, string> = {
  PASS: "text-pass border-pass/40 bg-pass/10",
  FAIL: "text-fail border-fail/40 bg-fail/10",
  NA: "text-na border-na/40 bg-na/10",
};

/**
 * Server-rendered. Nothing here is interactive, so none of this row data
 * needs to cross into the browser as component props — which is what it used
 * to do, on top of already being sent as HTML.
 */
export default function CatalogueRows({ rows }: { rows: CatalogueRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-fg-dim">
        Nothing recorded matches that. Every run in here was executed against a
        fork; there is no entry for an address Sidik has not actually traded.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
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
  );
}
