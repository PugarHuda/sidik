import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidik-eight.vercel.app";

/**
 * Open to indexers and to agents, except the two endpoints that are not
 * documents.
 *
 * /api/run holds a connection open and paces its events over several seconds
 * by design; a crawler that follows it gets a slow response and learns
 * nothing a page does not already show. /api/og is a PNG per address. The
 * JSON routes stay allowed: llms.txt points agents at them, and the agent
 * tools that honour robots.txt (Claude, ChatGPT, Perplexity) refused the very
 * data it recommended while `/api/` was blocked wholesale. Duplicate-content
 * worry is handled by the canonical on each run page, not here.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/run", "/api/og"] },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
