import { describe, it, expect } from "vitest";
import { interpretLpRug } from "../src/probes/lpRug.js";
const ctx = {} as any;

describe("interpretLpRug", () => {
  it("FAILs when the LP owner can pull liquidity and zero a holder", () => {
    const v = interpretLpRug({ lpOwner: "0xo", lpHolderFound: true, ownerLpPct: 100,
      holderValueBefore: "500", holderValueAfter: "3", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.numbers.ownerLpPct).toBe("100%");
  });

  it("PASSes when the LP holder was found and pulling it left holders whole", () => {
    const v = interpretLpRug({ lpOwner: "0xlocker", lpHolderFound: true, ownerLpPct: 100,
      holderValueBefore: "500", holderValueAfter: "500", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("PASS");
  });

  // Regression: the probe used to report PASS ("LP is locked/burned") whenever
  // it failed to find an LP holder, which is a verdict with nothing behind it.
  it("is NA (not PASS) when no LP holder could be identified", () => {
    const v = interpretLpRug({ lpOwner: "0x0000000000000000000000000000000000000000",
      lpHolderFound: false, ownerLpPct: 0,
      holderValueBefore: "500", holderValueAfter: "500", pullTxHash: "0x" }, ctx);
    expect(v.status).toBe("NA");
  });

  it("is NA when the largest holder found controls too little LP to test", () => {
    const v = interpretLpRug({ lpOwner: "0xdust", lpHolderFound: true, ownerLpPct: 0,
      holderValueBefore: "500", holderValueAfter: "500", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("NA");
  });

  it("is NA when no holder position could be priced to measure the pull", () => {
    const v = interpretLpRug({ lpOwner: "0xo", lpHolderFound: true, ownerLpPct: 100,
      holderValueBefore: "0", holderValueAfter: "0", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("NA");
  });
});
