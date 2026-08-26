"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CATALOGUE_FILTERS, type CatalogueFilter } from "@sidik/shared";

/**
 * The controls only. The rows they filter are rendered on the server.
 *
 * This component used to receive all 194 rows as props and filter them in the
 * browser, which meant the catalogue was serialised into the page twice —
 * once as HTML and once again as React props. It also kept the filter state
 * in React alone, so a filtered view could not be linked to, the back button
 * skipped straight past it, and the URL disagreed with the screen.
 *
 * The filters are plain links and the search is a real GET form, so both work
 * with JavaScript switched off. When it is on, typing updates the URL without
 * a full navigation.
 */
const DEBOUNCE_MS = 250;

export default function CatalogueControls({
  filter, query, shown, total,
}: {
  filter: CatalogueFilter;
  query: string;
  shown: number;
  total: number;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(query);
  const [isPending, startTransition] = useTransition();

  // The URL is the source of truth. A back/forward navigation changes it
  // without touching this component's state, so the box has to follow.
  //
  // Adjusted during render rather than in an effect: setting state inside an
  // effect renders once with the stale value and then again with the right
  // one, which React's own lint rule flags as a cascading render. Comparing
  // against the previous prop here is the documented way to reset state when
  // a prop changes — React restarts the render before committing anything.
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setDraft(query);
  }

  useEffect(() => {
    if (draft === query) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("filter", filter);
      if (draft.trim()) params.set("q", draft.trim());
      const qs = params.toString();
      // replace, not push: typing should not bury the previous page under one
      // history entry per keystroke.
      startTransition(() => router.replace(qs ? `/catalogue?${qs}` : "/catalogue"));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, query, filter, router]);

  const href = (id: CatalogueFilter) => {
    const params = new URLSearchParams();
    if (id !== "all") params.set("filter", id);
    if (query) params.set("q", query);
    const qs = params.toString();
    return qs ? `/catalogue?${qs}` : "/catalogue";
  };

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-2">
          {CATALOGUE_FILTERS.map((f) => (
            <Link
              key={f.id}
              href={href(f.id)}
              scroll={false}
              aria-pressed={filter === f.id}
              role="button"
              className={`rounded-md border px-3 py-1.5 font-mono text-xs transition ${
                filter === f.id
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-fg-dim hover:text-fg"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {/* A real GET form: submitting it navigates to the filtered URL even
            with no JavaScript running. */}
        <form action="/catalogue" method="get" className="contents">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <label htmlFor="catalogue-search" className="sr-only">Filter by symbol or address</label>
          <input
            id="catalogue-search"
            name="q"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="symbol or address…"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-md border border-border bg-panel px-3 py-1.5 font-mono text-xs text-fg placeholder:text-fg-dim/60 outline-none focus:border-accent sm:ml-auto sm:w-64"
          />
        </form>
      </div>

      <div
        className="mb-3 font-mono text-xs text-fg-dim"
        aria-live="polite"
        aria-busy={isPending}
      >
        {shown} of {total} recorded runs
      </div>
    </div>
  );
}
