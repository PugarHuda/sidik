import { describe, it, expect } from "vitest";
import { filterApplicable } from "../src/planner.js";
describe("filterApplicable", () => {
  it("drops probe ids that fail applicableWhen and dedupes", () => {
    const scan = { isErc20: true, hasPool: false } as any; // token, no pool
    const out = filterApplicable(["honeypot", "hiddenFee", "hiddenFee", "bogus"], scan);
    expect(out).toEqual(["hiddenFee"]); // honeypot needs a pool; bogus unknown; deduped
  });
});
