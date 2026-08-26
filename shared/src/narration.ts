import type { Verdict } from "./types";
import { headlineOf } from "./headline";

/**
 * The deterministic summary. Never wrong, never interesting.
 *
 * Used whenever model prose cannot be trusted — an unreachable gateway, an
 * invented figure, or a conclusion that contradicts the verdicts.
 */
export function templateNarration(verdicts: Verdict[]): string {
  return verdicts
    .map((v) => `${v.status === "FAIL" ? "⚠️" : v.status === "PASS" ? "✓" : "—"} ${v.title}`)
    .join("\n");
}

/**
 * Unqualified recommendations to act on the token.
 *
 * Deliberately narrow. Across the 194 recorded runs the bare word "safe"
 * appears in 11 narrations whose headline is FAIL, and almost every one is
 * legitimate — the prose is quoting the verdict's own row text ("Liquidity is
 * locked/safe") or scoping the claim, as in "safe from taxes and honeypot
 * behavior, but liquidity can be pulled at any time". Rejecting on the word
 * itself would throw away accurate summaries.
 *
 * What cannot stand next to a FAIL is an unscoped instruction: "safe to
 * trade" with no object. Measured against the same 194 runs, these patterns
 * match exactly one narration — Basedog's, which reads "Overall: safe to
 * trade, but liquidity can be pulled entirely by the owner", on a token whose
 * badge says FAIL — and none of the PASS or NA ones.
 */
const UNQUALIFIED_ALL_CLEAR = [
  /\bsafe to (trade|buy|hold|use|invest)/i,
  /\bno (issues|problems|red flags|concerns)\b[^.]{0,20}(found|detected|here)/i,
  /\bnothing (was )?(found )?wrong\b/i,
  /\b(appears|seems|looks) (to be )?safe\b(?![^.]{0,20}\bfrom\b)/i,
];

/**
 * True when the prose makes an all-clear claim the verdicts do not support.
 *
 * The existing guard in the engine checks every figure and every hex literal
 * against the run, which stops invented evidence — but it never read the
 * claim. A summary could get every number right and still close by telling
 * the reader a token that failed is safe to trade, which is the one sentence
 * this product must never print.
 */
export function contradictsVerdicts(narration: string, verdicts: Verdict[]): boolean {
  if (headlineOf(verdicts) !== "FAIL") return false;
  return UNQUALIFIED_ALL_CLEAR.some((re) => re.test(narration));
}

/**
 * The narration to show, which is the model's unless it contradicts the run.
 *
 * Applied where narration is served rather than only where it is produced, so
 * it covers runs recorded before this existed without re-recording them — the
 * verdicts are the proof and are untouched; only the prose falls back.
 */
export function safeNarration(narration: string, verdicts: Verdict[]): string {
  if (!narration) return templateNarration(verdicts);
  return contradictsVerdicts(narration, verdicts) ? templateNarration(verdicts) : narration;
}
