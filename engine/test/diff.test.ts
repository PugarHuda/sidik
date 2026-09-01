import { describe, it, expect } from "vitest";
import { diffRuns, describeDiff } from "@sidik/shared";
import type { Verdict } from "@sidik/shared";

const v = (probe: string, status: "PASS" | "FAIL" | "NA", extra: Partial<Verdict> = {}): Verdict => ({
  probe, status, title: `${probe} ${status}`, rows: [], numbers: {}, txHashes: [], ...extra,
} as Verdict);

describe("diffRuns", () => {
  it("finds nothing to say when both blocks agree", () => {
    const d = diffRuns([v("honeypot", "PASS")], [v("honeypot", "PASS")]);
    expect(d.changed).toEqual([]);
    expect(describeDiff(d, "1", "2")).toBeUndefined();
  });

  // The case the feature exists for. A catalogue pinned in August cannot say
  // this on its own, however many times it is re-read.
  it("reports a pass that no longer passes as a regression", () => {
    const d = diffRuns([v("honeypot", "PASS")], [v("honeypot", "FAIL")]);
    expect(d.regressed).toBe(true);
    expect(d.improved).toBe(false);
    expect(describeDiff(d, "50,200,000", "50,747,104"))
      .toMatch(/does not pass now.*honeypot/s);
  });

  it("reports a failure that stopped failing as an improvement, not a regression", () => {
    const d = diffRuns([v("ownerTrap", "FAIL")], [v("ownerTrap", "PASS")]);
    expect(d.improved).toBe(true);
    expect(d.regressed).toBe(false);
  });

  // "The mechanism is gone" and "we tried and could not tell" are different
  // answers, and a token that renounced its owner between the two blocks moves
  // from one to the other. Collapsing them would report that as no change.
  it("separates a probe that does not apply from one that could not answer", () => {
    const d = diffRuns([v("ownerTrap", "NA")], [v("ownerTrap", "NA", { applicable: false })]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]).toMatchObject({ before: "NA", after: "n/a here" });
  });

  // A probe that ran at only one block is exactly what happens when a contract
  // gains or loses a switch; dropping it silently would hide that.
  it("reports a probe appearing and disappearing", () => {
    const gained = diffRuns([], [v("ownerTrap", "FAIL")]);
    expect(gained.changed[0]).toMatchObject({ probe: "ownerTrap", before: "absent", after: "FAIL" });

    const lost = diffRuns([v("crossVenue", "PASS")], []);
    expect(lost.changed[0]).toMatchObject({ probe: "crossVenue", before: "PASS", after: "absent" });
  });

  it("carries the later run's sentence, which is the one describing the chain now", () => {
    const d = diffRuns([v("lpRug", "PASS")], [v("lpRug", "FAIL", { title: "LP rug possible" })]);
    expect(d.changed[0]!.title).toBe("LP rug possible");
  });

  // A regression and an improvement at once is a real shape: a token can
  // renounce its owner and lose its liquidity in the same fortnight.
  it("reports both directions when both happened", () => {
    const d = diffRuns([v("a", "PASS"), v("b", "FAIL")], [v("a", "FAIL"), v("b", "PASS")]);
    expect(d.regressed).toBe(true);
    expect(d.improved).toBe(true);
    expect(d.changed).toHaveLength(2);
  });
});
