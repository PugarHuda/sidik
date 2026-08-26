import Link from "next/link";
import { catalogueRows, catalogueSummary } from "@/lib/catalogue";
import CatalogueTable from "./CatalogueTable";

export const metadata = {
  title: "Sidik — every recorded run",
  description: "Every Base address Sidik has bought, sold and transferred against a fork, and what each one did.",
};

/**
 * Server component on purpose.
 *
 * The recorded runs carry every verdict, row and tx hash. Rendering this list
 * in the browser would ship all 194 of them to every visitor; deriving the
 * rows here means only what a row displays crosses the boundary.
 */
export default function CataloguePage() {
  const rows = catalogueRows();
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
        <CatalogueTable rows={rows} />
      </div>
    </div>
  );
}
