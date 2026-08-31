import type { MetadataRoute } from "next";
import { FIXTURES } from "@sidik/shared";

/**
 * Every recorded run, listed for indexers.
 *
 * Before this, a page of executed evidence existed for every recorded run and
 * not one of them could be found by anyone who did not already know the
 * address. Built with Next's own sitemap convention rather than a generated
 * file, so it cannot fall out of step with what is actually recorded — the
 * list is derived from the runs themselves.
 *
 * Server-only: this file is never part of a client bundle, so reading
 * Object.keys(FIXTURES) here costs the browser nothing.
 */
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidik-eight.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const runs: MetadataRoute.Sitemap = Object.keys(FIXTURES).map((address) => ({
    url: `${SITE}/run?token=${address}`,
    changeFrequency: "yearly",
    // The runs are pinned to one block, so a run page's content only changes
    // when the catalogue is re-recorded — never on its own.
    priority: 0.5,
  }));

  return [
    { url: SITE, changeFrequency: "monthly", priority: 1 },
    // The findings are the result the catalogue exists to support, so they
    // rank above the index of it.
    { url: `${SITE}/findings`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE}/catalogue`, changeFrequency: "monthly", priority: 0.8 },
    ...runs,
  ];
}
