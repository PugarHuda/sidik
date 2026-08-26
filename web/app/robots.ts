import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidik-eight.vercel.app";

/**
 * Open to indexers, except the streaming endpoints.
 *
 * /api/run holds a connection open and paces its events over several seconds
 * by design; a crawler that follows it gets a slow response and learns
 * nothing a page does not already show. /api/token is excluded for the same
 * reason — it is the machine-readable form of a page already in the sitemap,
 * so indexing both is duplicate content.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
