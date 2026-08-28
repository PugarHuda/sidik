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
 *
 * Two lines per row, by design: the verdict, the symbol and the finding on
 * the first; venue, listing, address and any caveat on the second, in the
 * smallest label size. On a phone the old single flex line broke into seven
 * stacked fragments and the row-as-a-line gestalt was gone.
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
        // Which probes failed, as data. The finding text beside it is a
        // verdict title, and titles are prose that gets rewritten as probes
        // learn to say more — "Honeypot — …" became "Cannot sell — the token
        // skims 2.99% …" on the day the probe learned to tell those apart.
        // Anything that needs to know what a row IS reads this, not the
        // sentence.
        <li
          key={r.address}
          data-failing={r.probes.filter((p) => p.status === "FAIL").map((p) => p.id).join(" ") || undefined}
          data-scanner-disagrees={r.scannerDisagrees ? "" : undefined}
        >
          <Link
            href={`/run?token=${r.address}`}
            className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3 transition hover:border-accent/50"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={`rounded border px-2 py-0.5 font-mono text-xs ${TONE[r.headline]}`}>
                {r.headline}
              </span>
              <span className="font-mono text-sm text-fg">{r.symbol}</span>
              <span className="text-sm text-fg-dim sm:flex-1">{r.finding}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-fg-dim">
              {r.venue && <span className="uppercase tracking-wider">Uniswap {r.venue}</span>}
              {r.listedAs && <span>listed on BingX</span>}
              <span>{r.address.slice(0, 6)}…{r.address.slice(-4)}</span>
              {r.sharesSymbolWith > 0 && (
                <span className="text-na">
                  +{r.sharesSymbolWith} other {r.sharesSymbolWith === 1 ? "token uses" : "tokens use"} this symbol
                </span>
              )}
              {/* Neutral, and the sentence is visible. It was an Evidence Blue
                  chip with the explanation in a title attribute — an accent on
                  something that cannot be tapped, carrying a fact that touch
                  and screen readers never surface. */}
              {r.scannerDisagrees && (
                <span>
                  <span className="rounded border border-border px-1.5 py-0.5">scanner disagrees</span>
                  {" "}{r.scannerDisagrees}
                </span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
