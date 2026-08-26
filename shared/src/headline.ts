import type { ProbeStatus } from "./types";

/**
 * The one rule that turns a set of verdicts into the single word a reader acts on.
 *
 * This decides whether someone is told a token is safe, so it gets exactly one
 * home. Three surfaces render it — the live run page, the catalogue, and the
 * JSON API — and if two of them disagreed, one of them would be lying.
 *
 * It lives here rather than in `web/lib` because the run page is a client
 * component: importing it from a module that also holds the recorded runs
 * would drag all 194 of them into the browser bundle.
 *
 * A probe whose mechanism does not exist for this token says nothing about it
 * and must not drag the headline down. LP-rug on a Uniswap V3 pool is the
 * case: 82 of the recorded tokens were once summarised as NA purely because
 * of it, while passing everything that did apply.
 */
export function headlineOf(
  verdicts: { status: ProbeStatus; applicable?: boolean }[],
): ProbeStatus {
  const answered = verdicts.filter((v) => v.applicable !== false);
  if (answered.length === 0) return "NA";
  if (answered.some((v) => v.status === "FAIL")) return "FAIL";
  if (answered.some((v) => v.status === "NA")) return "NA";
  return "PASS";
}
