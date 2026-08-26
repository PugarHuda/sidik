import Link from "next/link";
import type { CataloguePage, CatalogueFilter } from "@sidik/shared";

/**
 * Prev/next as plain links, so paging works without JavaScript and every page
 * of the catalogue has its own address.
 */
export default function CataloguePager({
  page, filter, query,
}: {
  page: CataloguePage;
  filter: CatalogueFilter;
  query: string;
}) {
  const href = (n: number) => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("filter", filter);
    if (query) params.set("q", query);
    if (n > 1) params.set("page", String(n));
    const qs = params.toString();
    return qs ? `/catalogue?${qs}` : "/catalogue";
  };

  // An unavailable direction renders nothing at all, and an empty box holds
  // the space so the row does not jump between pages.
  //
  // It was first drawn as dimmed text — text-fg-dim/40, then opacity-60 — and
  // axe flagged both for contrast on every browser. Greying out a control is
  // the reflex, and it is the same mistake the palette work existed to stop:
  // the way to say "you cannot go this way" is to not offer the way, not to
  // make the words hard to read.
  const linkClass = "rounded-md border border-border px-3 py-1.5 font-mono text-xs text-fg-dim transition hover:border-accent/60 hover:text-fg";

  if (page.pageCount <= 1) return null;

  return (
    <nav className="mt-6 flex items-center justify-between gap-4" aria-label="Catalogue pages">
      <span className="min-w-[6.5rem]">
        {page.page > 1 && (
          <Link href={href(page.page - 1)} rel="prev" className={linkClass}>← previous</Link>
        )}
      </span>

      <span className="font-mono text-xs text-fg-dim">
        showing {page.from}&ndash;{page.to} · page {page.page} of {page.pageCount}
      </span>

      <span className="min-w-[6.5rem] text-right">
        {page.page < page.pageCount && (
          <Link href={href(page.page + 1)} rel="next" className={linkClass}>next →</Link>
        )}
      </span>
    </nav>
  );
}
