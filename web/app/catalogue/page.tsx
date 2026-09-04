import Link from "next/link";
import {
  CATALOGUE_FILTERS, FIXTURE_BLOCK, catalogueRows, catalogueSummary, filterCounts, filterRows,
  isCatalogueFilter, paginate, VERIFICATION_STATS,
} from "@sidik/shared";
import CatalogueControls from "./CatalogueControls";
import CatalogueRows from "./CatalogueRows";
import CataloguePager from "./CataloguePager";

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
  searchParams: Promise<{
    filter?: string | string[];
    q?: string | string[];
    page?: string | string[];
  }>;
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
  const matching = filterRows(rows, { filter, query });
  // Bounded on purpose: rendering every row produced a 336KB document (at 194
  // of them; the catalogue has grown since), and
  // a response that size is read slowly enough by a browser to back up the
  // server's gzip stream — measurably, and fatally under a full test run.
  const page = paginate(matching, Number(one(params.page)) || 1);
  const s = catalogueSummary(rows);
  const counts = filterCounts(rows);
  const current = CATALOGUE_FILTERS.find((f) => f.id === filter)!;

  const href = (id: string) => {
    const p = new URLSearchParams();
    if (id !== "all") p.set("filter", id);
    if (query) p.set("q", query);
    const qs = p.toString();
    return qs ? `/catalogue?${qs}` : "/catalogue";
  };

  // Structured data: the catalogue is a dataset with a JSON distribution, and
  // saying so in the vocabulary indexers already read is how it gets found
  // by someone searching for Base token data rather than for this site.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "Sidik — executed Base token runs",
    description: `${rows.length} Base addresses bought, sold and transferred against a fork of Base at block ${Number(FIXTURE_BLOCK).toLocaleString("en-US")}, with every verdict and measured figure.`,
    // No `license` key: it pointed at a LICENSE file the repository does not
    // have, so every catalogue page served a machine-readable 404 to exactly
    // the automated readers this block exists for. Add it back with the URL
    // once a licence is chosen.
    isAccessibleForFree: true,
    keywords: ["Base", "ERC-20", "honeypot", "token safety", "fork execution"],
    distribution: [
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "/api/catalogue" },
      { "@type": "DataDownload", encodingFormat: "text/plain", contentUrl: "/llms.txt" },
    ],
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Link href="/" className="font-mono text-sm tracking-[0.3em] text-accent">SIDIK</Link>

      {/* The heading follows the filter. It used to read "Every recorded run"
          over a list of eleven, with the only sign of the filter a count two
          screens down. */}
      <h1 className="mt-6 font-mono text-3xl font-semibold tracking-tight text-fg">
        {filter === "all" ? "Every recorded run" : current.label}
      </h1>
      <p className="mt-3 max-w-2xl text-fg-dim">
        {filter === "all"
          ? <>Each of these was executed, not assessed: Sidik forked Base at block 50,200,000, bought the token with a funded test wallet, tried to sell it back, transferred it, and where an LP holder could be found, pulled the pool out from under it. Failures are listed first.</>
          : <>{matching.length} of {rows.length} recorded runs. Each was executed against a fork of Base at block 50,200,000; failures are listed first.</>}
      </p>

      {/* The tiles ARE the filters. Each is a link carrying its own count, so
          the number on it is always the number of rows it shows; the selected
          one carries aria-current. One set of controls where there used to be
          eight tiles that could not be tapped above seven chips that could. */}
      <nav aria-label="Filter recorded runs" className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CATALOGUE_FILTERS.map((f) => {
          const selected = f.id === filter;
          return (
            <Link
              key={f.id}
              href={href(f.id)}
              aria-current={selected ? "page" : undefined}
              data-filter-tile={f.id}
              className={`block rounded-lg border px-4 py-3 transition ${
                selected
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-card text-fg hover:border-accent/50"
              }`}
            >
              <span className={`block font-mono text-[11px] uppercase tracking-wider ${selected ? "text-accent" : "text-fg-dim"}`}>
                {f.label}
              </span>
              <span className="mt-1 block font-mono text-2xl tabular-nums">{counts[f.id]}</span>
            </Link>
          );
        })}
      </nav>

      <p className="mt-4 font-mono text-xs text-fg-dim">
        {s.onV3} trade on Uniswap V3 · {s.onV2} on V2 · {s.total - s.onV3 - s.onV2} on neither
      </p>

      {/* Kept next to the counts because it is the honest frame for them: the
          usual way to vet a token would have cleared almost every one of the
          ones below that failed. Source: Blockscout, per address, recorded in
          shared/src/verification.ts. */}
      <p className="mt-3 max-w-2xl text-sm text-fg-dim">
        {VERIFICATION_STATS.failingVerified} of the {VERIFICATION_STATS.failing} runs with a
        finding against them publish verified source code on Blockscout, as do{" "}
        {VERIFICATION_STATS.verified} of all {VERIFICATION_STATS.checked}. Whatever was proven
        below, it was proven about a contract anyone could already read.
      </p>

      {/* The catalogue is structured data rendered as a page, and until now the
          only way to consume it was to scrape that page. The link carries the
          filter and search currently applied, so whatever a reader narrowed it
          to is what they get. */}
      <p className="mt-2 font-mono text-xs text-fg-dim">
        <a
          href={`/api/catalogue?${new URLSearchParams({
            ...(filter !== "all" ? { filter } : {}),
            ...(query ? { q: query } : {}),
          })}`}
          className="underline underline-offset-4 hover:text-fg"
        >
          this view as JSON
        </a>
        {" · "}
        <a href="/llms.txt" className="underline underline-offset-4 hover:text-fg">
          what an agent needs to know before using it
        </a>
      </p>

      <div className="mt-8">
        <CatalogueControls
          filter={filter}
          query={query}
          shown={page.total}
          total={rows.length}
        />
        <CatalogueRows rows={page.rows} />
        <CataloguePager page={page} filter={filter} query={query} />
      </div>
    </div>
  );
}
