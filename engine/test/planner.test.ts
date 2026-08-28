import { describe, it, expect } from "vitest";
import { filterApplicable, orderedByPlan } from "../src/planner.js";
import { PROBES } from "../src/probes/registry.js";

describe("filterApplicable", () => {
  it("drops probe ids that fail applicableWhen and dedupes", () => {
    const scan = { isErc20: true, hasPool: false } as any; // token, no pool
    const out = filterApplicable(["honeypot", "hiddenFee", "hiddenFee", "bogus"], scan);
    expect(out).toEqual(["hiddenFee"]); // honeypot needs a pool; bogus unknown; deduped
  });
});

describe("orderedByPlan", () => {
  // A token with a pool: everything except crossVenue applies (that one needs
  // a venue listing, and this address has none).
  const scan = { token: "0x0000000000000000000000000000000000000001", isErc20: true, hasPool: true, topHolders: [] } as any;
  const applicable = PROBES.filter((p) => p.applicableWhen(scan)).map((p) => p.id);

  it("keeps the model's order", () => {
    const out = orderedByPlan(["lpRug", "honeypot"], scan);
    expect(out.slice(0, 2)).toEqual(["lpRug", "honeypot"]);
  });

  // The bug this closes: the model returned four of the six applicable probes
  // and the run was recorded without the other two. A page missing a card is
  // indistinguishable from a page where that check passed.
  it("appends every applicable probe the model left out", () => {
    const out = orderedByPlan(["honeypot"], scan);
    expect(new Set(out)).toEqual(new Set(applicable));
    expect(out[0]).toBe("honeypot");
  });

  // Composed the way planProbes composes them: the model's answer is filtered
  // first, then ordered. Neither step may let through a probe whose mechanism
  // does not exist for this token.
  it("never yields a probe that does not apply", () => {
    const noPool = { token: "0x0000000000000000000000000000000000000001", isErc20: true, hasPool: false, topHolders: [] } as any;
    const out = orderedByPlan(filterApplicable(["honeypot", "lpRug", "bogus"], noPool), noPool);
    expect(out.length).toBeGreaterThan(0);
    for (const id of out) {
      expect(PROBES.find((p) => p.id === id)!.applicableWhen(noPool), id).toBe(true);
    }
    expect(out).not.toContain("honeypot"); // needs a pool
  });

  it("does not duplicate a probe the model already named", () => {
    const out = orderedByPlan(applicable, scan);
    expect(out).toEqual(applicable);
    expect(new Set(out).size).toBe(out.length);
  });
});
