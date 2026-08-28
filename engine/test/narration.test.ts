import { describe, expect, it } from "vitest";
import { FIXTURES, contradictsVerdicts, headlineOf, safeNarration, templateNarration } from "@sidik/shared";
import type { Verdict } from "@sidik/shared";

const v = (probe: string, status: Verdict["status"], title: string, applicable?: boolean): Verdict => ({
  probe, status, title, rows: [], numbers: {}, txHashes: [],
  ...(applicable === undefined ? {} : { applicable }),
});

const FAILED = [
  v("honeypot", "PASS", "Not a honeypot — buy and sell both succeed"),
  v("lpRug", "FAIL", "LP rug possible — owner can pull all liquidity"),
];
const PASSED = [v("honeypot", "PASS", "Not a honeypot — buy and sell both succeed")];

describe("contradictsVerdicts", () => {
  it("rejects an unqualified recommendation on a token that failed", () => {
    // The real one, from the recorded catalogue: every figure in it is
    // correct and the existing numeric guard passed it.
    const basedog = "Basedog passed the honeypot check and showed no hidden fees. "
      + "However, it failed the LP rug check. Overall: safe to trade, but liquidity "
      + "can be pulled entirely by the owner at any time.";
    expect(contradictsVerdicts(basedog, FAILED)).toBe(true);
  });

  it("allows a scoped safety claim that names the risk", () => {
    // Also from the catalogue. This one is accurate: the claim is bounded to
    // the probes that passed and the failure is stated outright. A rule that
    // fired on the word "safe" would have thrown it away.
    const pepeto = "Overall: safe from taxes and honeypot behavior, but liquidity can be "
      + "pulled at any time by the owner, posing a significant rug-pull risk.";
    expect(contradictsVerdicts(pepeto, FAILED)).toBe(false);
  });

  it("allows prose quoting the verdict's own wording", () => {
    // "Liquidity is locked/safe" is the text of a row label, so the word
    // turns up in honest summaries constantly.
    const quoting = "The owner can drain the pool despite the claim that liquidity is locked/safe.";
    expect(contradictsVerdicts(quoting, FAILED)).toBe(false);
  });

  it("says nothing about a token that did not fail", () => {
    expect(contradictsVerdicts("Overall: safe to trade.", PASSED)).toBe(false);
  });

  it("does not count a probe that could not apply as a failure", () => {
    const inapplicable = [
      v("honeypot", "PASS", "Not a honeypot"),
      v("lpRug", "NA", "LP rug does not apply — this token trades on Uniswap V3", false),
    ];
    expect(headlineOf(inapplicable)).toBe("PASS");
    expect(contradictsVerdicts("Overall: safe to trade.", inapplicable)).toBe(false);
  });
});

describe("safeNarration", () => {
  it("falls back to the template when the prose contradicts the run", () => {
    const out = safeNarration("Overall: safe to buy.", FAILED);
    expect(out).toBe(templateNarration(FAILED));
    expect(out).toContain("⚠️");
    expect(out).not.toContain("safe to buy");
  });

  it("leaves honest prose exactly as written", () => {
    const honest = "It failed the LP rug check: the owner holds all of the LP.";
    expect(safeNarration(honest, FAILED)).toBe(honest);
  });

  it("produces something rather than nothing for an empty narration", () => {
    expect(safeNarration("", FAILED)).toBe(templateNarration(FAILED));
    expect(safeNarration("", [])).toBe("");
  });
});

describe("every recorded run, served", () => {
  it("never tells a reader a failed token is safe to trade", () => {
    const offenders: string[] = [];
    for (const [address, run] of Object.entries(FIXTURES)) {
      const served = safeNarration(run.narration, run.verdicts);
      if (contradictsVerdicts(served, run.verdicts)) offenders.push(address);
    }
    expect(offenders).toEqual([]);
  });

  it("still serves the model's own prose for almost every run", () => {
    // The guard has to be narrow enough to leave the catalogue intact. If a
    // future change makes it broad, this is what notices.
    //
    // A share rather than a count. The first version of this pinned the exact
    // number, which was a fact about one recording: every re-record generates
    // fresh prose, so the count moves for reasons that are not regressions,
    // and a test that fails on a legitimate change teaches people to ignore
    // it. What must not change is that this stays rare — the bare word "safe"
    // appears in eleven FAIL narrations and nearly all of them are legitimate,
    // quoting a row label or scoping the claim.
    const runs = Object.values(FIXTURES);
    const replaced = runs
      .filter((run) => safeNarration(run.narration, run.verdicts) !== run.narration).length;
    expect(replaced / runs.length,
      `${replaced} of ${runs.length} narrations were replaced; the guard is meant to be narrow`)
      .toBeLessThanOrEqual(0.05);
  });
});
