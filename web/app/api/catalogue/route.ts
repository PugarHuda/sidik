import type { NextRequest } from "next/server";
import {
  CATALOGUE_FILTERS, FIXTURE_BLOCK, catalogueRows, catalogueSummary,
  filterRows, isCatalogueFilter, paginate, venueListings, verificationOf,
} from "@sidik/shared";
import { PROVENANCE } from "@/lib/provenance";

export const runtime = "nodejs";

const FORK_BLOCK = Number(FIXTURE_BLOCK);

/**
 * The whole catalogue, as JSON, one page at a time.
 *
 * `/api/token/<address>` answers about an address you already have. This
 * answers the question before it: which addresses are covered, and what was
 * found. Without it the only way to consume the catalogue was to scrape the
 * HTML — in a competition about agents, on a project whose output is
 * structured data.
 *
 * Derived from the same functions the HTML page uses, so the two cannot drift
 * into disagreeing about what a filter means or how many rows there are.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const one = (name: string) => q.get(name) ?? "";
  const rawFilter = one("filter");
  const filter = isCatalogueFilter(rawFilter) ? rawFilter : "all";
  const query = one("q").slice(0, 100);

  const all = catalogueRows();
  const page = paginate(filterRows(all, { filter, query }), Number(one("page")) || 1);

  return Response.json({
    schemaVersion: 1,
    chainId: 8453,
    forkBlock: FORK_BLOCK,
    // Said once, at the top, so a consumer cannot take a hash from a row and
    // go looking for it on an explorer.
    transactionsWereBroadcast: false,
    filter,
    query: query || null,
    availableFilters: CATALOGUE_FILTERS.map((f) => ({ id: f.id, label: f.label })),
    summary: catalogueSummary(all),
    page: page.page,
    pageCount: page.pageCount,
    total: page.total,
    rows: page.rows.map((r) => ({
      ...r,
      // Corroboration travels with the row, in its own field, so it can never
      // be mistaken for one of the probe results beside it.
      corroboration: {
        alsoTradesOn: venueListings(r.address),
        sourceVerified: verificationOf(r.address)?.verified ?? null,
      },
      run: `/api/token/${r.address}`,
    })),
    provenance: PROVENANCE,
  }, {
    headers: { "cache-control": "public, max-age=300, stale-while-revalidate=86400" },
  });
}
