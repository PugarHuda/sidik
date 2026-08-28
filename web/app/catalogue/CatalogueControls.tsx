"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CatalogueFilter } from "@sidik/shared";

/**
 * The search only. The filters are the tiles above it (see page.tsx), and
 * the rows they narrow are rendered on the server.
 *
 * This component used to receive all 194 rows as props and filter them in the
 * browser, which meant the catalogue was serialised into the page twice —
 * once as HTML and once again as React props. It also kept the filter state
 * in React alone, so a filtered view could not be linked to, the back button
 * skipped straight past it, and the URL disagreed with the screen.
 *
 * The search is a real GET form, so it works with JavaScript switched off.
 * When it is on, typing updates the URL without a full navigation.
 */
const DEBOUNCE_MS = 250;

export default function CatalogueControls({
  filter, query, shown, total,
}: {
  filter: CatalogueFilter;
  query: string;
  /** Rows matching the current filter and query, across every page. */
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

  return (
    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div
        className="font-mono text-xs text-fg-dim"
        aria-live="polite"
        aria-busy={isPending}
      >
        {shown} of {total} recorded runs
      </div>
      {/* A real GET form: submitting it navigates to the filtered URL even
          with no JavaScript running. */}
      <form action="/catalogue" method="get" className="contents">
        {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
        <label htmlFor="catalogue-search" className="sr-only">Filter by symbol or address</label>
        <input
          id="catalogue-search"
          name="q"
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search by symbol or address…"
          spellCheck={false}
          autoComplete="off"
          className="w-full rounded-md border border-border bg-panel px-3 py-2 font-mono text-xs text-fg placeholder:text-fg-dim/60 outline-none focus:border-accent sm:w-72"
        />
      </form>
    </div>
  );
}
