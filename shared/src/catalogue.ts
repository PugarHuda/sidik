import { FIXTURES, impostorsOf, type FrozenRun } from "./fixtures";
import { headlineOf } from "./headline";
import { listedTicker } from "./listings";
import type { ProbeStatus } from "./types";

/**
 * A compact row per recorded run.
 *
 * Derived on the server and nowhere else. The runs themselves carry every
 * verdict, every row and every tx hash — 194 of them — and handing that to the
 * browser to render a list would ship the entire catalogue to every visitor.
 * Only what a row displays crosses the boundary.
 */
export interface CatalogueRow {
  address: string;
  symbol: string;
  venue: "v2" | "v3" | null;
  /** Probe id -> status, for the probes that actually ran. */
  probes: { id: string; status: ProbeStatus; applicable: boolean }[];
  /** The same rule the run page uses: a probe that cannot apply does not count. */
  headline: ProbeStatus;
  /** One line, taken from the failing verdict when there is one. */
  finding: string;
  listedAs: string | null;
  /** Other recorded addresses using this same symbol. */
  sharesSymbolWith: number;
}

export function catalogueRows(): CatalogueRow[] {
  const rows: CatalogueRow[] = Object.entries(FIXTURES).map(([address, run]) => {
    const headline = headlineOf(run.verdicts);
    const failed = run.verdicts.find((v) => v.status === "FAIL");
    // A passing run's most useful line is not "nothing found" but what was
    // actually established, so fall back to the first verdict's title.
    const finding = failed?.title ?? run.verdicts[0]?.title ?? "No probe applied";
    return {
      address,
      symbol: run.scan.symbol || "?",
      venue: (run.scan.venue as "v2" | "v3" | undefined) ?? null,
      probes: run.verdicts.map((v) => ({
        id: v.probe, status: v.status, applicable: v.applicable !== false,
      })),
      headline,
      finding,
      listedAs: listedTicker(address) ?? null,
      sharesSymbolWith: impostorsOf(address).length,
    };
  });

  // Failures first: a catalogue of proofs is worth browsing for what it
  // caught, and a reader should not have to page through the clean ones.
  const rank: Record<ProbeStatus, number> = { FAIL: 0, NA: 1, PASS: 2 };
  return rows.sort((a, b) =>
    rank[a.headline] - rank[b.headline] || a.symbol.localeCompare(b.symbol));
}

/**
 * The recorded run for one address, or undefined.
 *
 * The single place FIXTURES is looked up by key. A bare `FIXTURES[key]` walks
 * the prototype chain: `FIXTURES["constructor"]` is the Object constructor,
 * not undefined, and a caller that checked `if (!run)` would sail past the
 * guard and then read `.scan` off a function. Every caller validates the
 * address first today, so nothing reaches this — which is precisely why it is
 * worth closing before someone adds a caller that does not.
 */
export function recordedRun(address: string): FrozenRun | undefined {
  const key = String(address).toLowerCase();
  return Object.hasOwn(FIXTURES, key) ? FIXTURES[key] : undefined;
}

/** The filters the catalogue offers, and what each one keeps. */
export const CATALOGUE_FILTERS = [
  { id: "all", label: "Everything" },
  { id: "failing", label: "Anything failed" },
  { id: "honeypot", label: "Honeypots" },
  { id: "hiddenFee", label: "Hidden fees" },
  { id: "lpRug", label: "LP rugs" },
] as const;

export type CatalogueFilter = (typeof CATALOGUE_FILTERS)[number]["id"];

export function isCatalogueFilter(v: string | undefined): v is CatalogueFilter {
  return CATALOGUE_FILTERS.some((f) => f.id === v);
}

/**
 * Narrow the catalogue. Pure, so it can run on the server and be tested
 * without a browser.
 *
 * This used to live inside a client component, which meant every row had to
 * be serialised into the page as component props on top of already being
 * rendered as HTML — the same 194 addresses shipped twice. Filtering here
 * means the browser receives only the rows it is going to show.
 */
export function filterRows(
  rows: CatalogueRow[],
  { filter, query }: { filter: CatalogueFilter; query: string },
): CatalogueRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter === "failing" && r.headline !== "FAIL") return false;
    if (filter !== "all" && filter !== "failing"
      && !r.probes.some((p) => p.id === filter && p.status === "FAIL")) return false;
    if (!q) return true;
    return r.symbol.toLowerCase().includes(q) || r.address.toLowerCase().includes(q);
  });
}

export function catalogueSummary(rows: CatalogueRow[]) {
  const count = (id: string) =>
    rows.filter((r) => r.probes.some((p) => p.id === id && p.status === "FAIL")).length;
  return {
    total: rows.length,
    failing: rows.filter((r) => r.headline === "FAIL").length,
    honeypots: count("honeypot"),
    taxed: count("hiddenFee"),
    lpRugs: count("lpRug"),
    drainableWallets: count("approvalDrain"),
    onV3: rows.filter((r) => r.venue === "v3").length,
    onV2: rows.filter((r) => r.venue === "v2").length,
  };
}
