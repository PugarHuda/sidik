import { FIXTURES, impostorsOf, listedTicker } from "@sidik/shared";
import type { ProbeStatus } from "@sidik/shared";

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

export function headlineOf(
  verdicts: { status: ProbeStatus; applicable?: boolean }[],
): ProbeStatus {
  const answered = verdicts.filter((v) => v.applicable !== false);
  if (answered.length === 0) return "NA";
  if (answered.some((v) => v.status === "FAIL")) return "FAIL";
  if (answered.some((v) => v.status === "NA")) return "NA";
  return "PASS";
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
