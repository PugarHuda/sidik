import { describe, it, expect } from "vitest";
import { interpretLpRug } from "../src/probes/lpRug";
const ctx = {} as any;

describe("interpretLpRug", () => {
  it("FAILs when the LP owner can pull liquidity and zero a holder", () => {
    const v = interpretLpRug({ lpOwner: "0xo", lpHolderFound: true, ownerLpPct: 100, burnedLpPct: 0,
      holderValueBefore: "500", holderValueAfter: "3", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.numbers.ownerLpPct).toBe("100%");
  });

  it("PASSes when the LP holder was found and pulling it left holders whole", () => {
    const v = interpretLpRug({ lpOwner: "0xlocker", lpHolderFound: true, ownerLpPct: 100, burnedLpPct: 0,
      holderValueBefore: "500", holderValueAfter: "500", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("PASS");
  });

  // Regression, found in the shipped catalogue on HIGHER, BRETT, TOSHI and
  // AIXBT: this branch is reached only after burned LP and a locker have both
  // been ruled out, and it titled itself "LP is locked/burned" anyway — over
  // numbers reading 0% burned. On TOSHI and AIXBT it also said the holder
  // "controls only 100%".
  it("never claims the LP is locked or burned on a pull that was executed", () => {
    const v = interpretLpRug({ lpOwner: "0xo", lpHolderFound: true, ownerLpPct: 100, burnedLpPct: 0,
      holderValueBefore: "139.94", holderValueAfter: "136.88", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.title).not.toMatch(/locked|burned/i);
    expect(v.rows[0]?.proven).not.toMatch(/only 100%/i);
    expect(v.rows[0]?.proven).toMatch(/neither burned nor locked/i);
  });

  // A pull that costs a holder 40% of their exit is the harm this probe exists
  // to find; only a >50% collapse used to count, so it read PASS.
  it("FAILs when the pull repriced a holder's exit without draining the pool", () => {
    const v = interpretLpRug({ lpOwner: "0xo", lpHolderFound: true, ownerLpPct: 36, burnedLpPct: 0,
      holderValueBefore: "1.93", holderValueAfter: "1.16", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toMatch(/39.9%|40%/);
  });

  // Removing a position always moves the price a little; that is impact, not a
  // rug, and calling it one would fail most of the catalogue's deepest pools.
  it("stays PASS when the pull cost less than the material-loss line", () => {
    const v = interpretLpRug({ lpOwner: "0xo", lpHolderFound: true, ownerLpPct: 8, burnedLpPct: 0,
      holderValueBefore: "8.09", holderValueAfter: "8.07", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("PASS");
  });

  // Burned LP cannot be withdrawn by anyone, so this is real proof of safety
  // and needs no holder discovery — the common case for a locked pool.
  it("PASSes on burned LP without needing to find a holder", () => {
    const v = interpretLpRug({ lpOwner: "0x0000000000000000000000000000000000000000",
      lpHolderFound: false, ownerLpPct: 0, burnedLpPct: 99.98,
      holderValueBefore: "0", holderValueAfter: "0", pullTxHash: "0x" }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.numbers.burnedLpPct).toBe("99.98%");
    expect(v.title).toMatch(/burned/i);
  });

  // Regression: the probe used to report PASS ("LP is locked/burned") whenever
  // it failed to find an LP holder, which is a verdict with nothing behind it.
  it("is NA (not PASS) when LP is unburned and no holder could be identified", () => {
    const v = interpretLpRug({ lpOwner: "0x0000000000000000000000000000000000000000",
      lpHolderFound: false, ownerLpPct: 0, burnedLpPct: 0,
      holderValueBefore: "500", holderValueAfter: "500", pullTxHash: "0x" }, ctx);
    expect(v.status).toBe("NA");
    expect(v.title).toMatch(/not burned/i);
  });

  it("is NA when the largest holder found controls too little LP to test", () => {
    const v = interpretLpRug({ lpOwner: "0xdust", lpHolderFound: true, ownerLpPct: 0, burnedLpPct: 12,
      holderValueBefore: "500", holderValueAfter: "500", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("NA");
  });

  it("is NA when no holder position could be priced to measure the pull", () => {
    const v = interpretLpRug({ lpOwner: "0xo", lpHolderFound: true, ownerLpPct: 100, burnedLpPct: 0,
      holderValueBefore: "0", holderValueAfter: "0", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("NA");
  });
});

// Regression: excluding the probe on V3 made its card disappear entirely, and
// a missing card cannot be told apart from a check that was never run.
it("says why it does not apply on a V3 token instead of vanishing", () => {
  const v = interpretLpRug({ notApplicable: "v3" } as any, ctx);
  expect(v.status).toBe("NA");
  expect(v.title).toMatch(/uniswap v3/i);
  expect(v.rows[0]?.proven).toMatch(/NFT positions/i);
});
