import { describe, it, expect } from "vitest";
import { interpretLpRug } from "../src/probes/lpRug.js";
const ctx = {} as any;
describe("interpretLpRug", () => {
  it("FAILs when the LP owner can pull liquidity and zero a holder", () => {
    const v = interpretLpRug({ lpOwner: "0xo", ownerLpPct: 100,
      holderValueBefore: "500", holderValueAfter: "3", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.numbers.ownerLpPct).toBe("100%");
  });
  it("PASSes when LP is locked/burned (owner holds ~0%)", () => {
    const v = interpretLpRug({ lpOwner: "0x0", ownerLpPct: 0,
      holderValueBefore: "500", holderValueAfter: "500", pullTxHash: "0x" }, ctx);
    expect(v.status).toBe("PASS");
  });
});
