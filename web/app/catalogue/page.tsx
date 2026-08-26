import Link from "next/link";
import {
  catalogueRows, catalogueSummary, filterRows, isCatalogueFilter,
} from "@sidik/shared";
import CatalogueControls from "./CatalogueControls";
import CatalogueRows from "./CatalogueRows";

export const metadata = {
  title: "Sidik — every recorded run",
  description: "Every Base address Sidik has bought, sold and transferred against a fork, and what each one did.",
};

/**
 * Server component, and the filtering happens here too.
 *
 * The recorded runs carry every verdict, row and tx hash, so deriving the
 * rows here keeps all of that on the server. Filtering was the part still
 * happening in the browser: the client component took every row as props,
 * which serialised the whole catalogue into the page a second time on top of
 * the HTML it was already rendered as — one address appeared twice in a
 * measured 222KB document.
 *
 * Reading the filter from the URL also makes it the single source of truth.
 * It used to live in React state alone, so a filtered view could not be
 * linked or bookmarked and the back button stepped straight over it.
 */
export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string | string[]; q?: string | string[] }>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const rawFilter = one(params.filter);
  // An unknown filter shows everything rather than nothing: a hand-edited URL
  // should not produce an empty page that looks like a catalogue with no runs
  // in it.
  const filter = isCatalogueFilter(rawFilter) ? rawFilter : "all";
  const query = one(params.q).slice(0, 100);

  const rows = catalogueRows();
  const shown = filterRows(rows, { filter, query });
  const s = catalogueSummary(rows);

  const stats: [string, number][] = [
    ["recorded runs", s.total],
    ["something failed", s.failing],
    ["honeypots", s.honeypots],
    ["hidden fees", s.taxed],
    ["LP rugs", s.lpRugs],
    ["drainable wallets", s.drainableWallets],
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-16">
      <Link href="/" className="font-mono text-sm tracking-[0.3em] text-accent">SIDIK</Link>

      <h1 className="mt-6 font-mono text-3xl font-semibold tracking-tight text-fg">
        Every recorded run
      </h1>
      <p className="mt-3 max-w-2xl text-fg-dim">
        Each of these was executed, not assessed: Sidik forked Base at block
        50,200,000, bought the token with a funded test wallet, tried to sell it
        back, transferred it, and where an LP holder could be found, pulled the
        pool out from under it. Failures are listed first.
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
            <dt className="font-mono text-[11px] uppercase tracking-wider text-fg-dim">{label}</dt>
            <dd className="mt-1 font-mono text-2xl text-fg">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 font-mono text-xs text-fg-dim">
        {s.onV3} trade on Uniswap V3 · {s.onV2} on V2
      </p>

      <div className="mt-10">
        <CatalogueControls
          filter={filter}
          query={query}
          shown={shown.length}
          total={rows.length}
        />
        <CatalogueRows rows={shown} />
      </div>
    </div>
  );
}
