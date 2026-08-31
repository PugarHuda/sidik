import { describe, it, expect } from "vitest";
import { interpretHiddenFee } from "../src/probes/hiddenFee";
const ctx = {} as any;
describe("interpretHiddenFee", () => {
  it("FAILs when received < sent (hidden tax)", () => {
    const v = interpretHiddenFee({ sent: "1000", received: "900", feeBps: 1000, xferTxHash: "0xh" }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.numbers.feePct).toBe("10%");
  });
  it("PASSes when received == sent (no fee)", () => {
    const v = interpretHiddenFee({ sent: "1000", received: "1000", feeBps: 0, xferTxHash: "0xh" }, ctx);
    expect(v.status).toBe("PASS");
  });
  it("is NA (not PASS) when the buy acquired no tokens to test", () => {
    const v = interpretHiddenFee({ sent: "0", received: "0", feeBps: 0, xferTxHash: "0x" }, ctx);
    expect(v.status).toBe("NA");
  });
});

describe("interpretHiddenFee — evidence honesty", () => {
  it("FAILs with a revert message, not a fabricated 100% fee, when transfer() reverts", () => {
    const v = interpretHiddenFee(
      { sent: "1000", received: "0", transferReverted: true, feeBps: 0, xferTxHash: "0xh" } as any, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.numbers.feePct).toBe("n/a");
    expect(v.title).toMatch(/reverted/i);
  });
  it("PASSes when a reflection token credits more than was sent (no negative fee)", () => {
    const v = interpretHiddenFee({ sent: "1000", received: "1100", feeBps: 0, xferTxHash: "0xh" }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.numbers.feePct).toBe("0%");
  });
});

describe("interpretHiddenFee — tax charged through the pool", () => {
  // Regression: taxing tokens on Base charge on the pool route and leave
  // wallet-to-wallet transfers alone, so a transfer-only test PASSed them.
  it("FAILs on a buy tax even when plain transfers are untaxed", () => {
    const v = interpretHiddenFee(
      { sent: "1000", received: "1000", buyTaxBps: 299, feeBps: 0,
        buyTxHash: "0xb", xferTxHash: "0xh" } as any, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toMatch(/2\.99% on buy/i);
    expect(v.numbers.buyTaxPct).toBe("2.99%");
    expect(v.txHashes).toContain("0xb");
  });

  it("reports both when a token taxes the buy and the transfer", () => {
    const v = interpretHiddenFee(
      { sent: "1000", received: "900", buyTaxBps: 299, feeBps: 1000,
        buyTxHash: "0xb", xferTxHash: "0xh" } as any, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toContain("2.99%");
    expect(v.title).toContain("10%");
  });

  it("does not read swap dust as a tax", () => {
    const v = interpretHiddenFee(
      { sent: "1000", received: "1000", buyTaxBps: 3, feeBps: 0,
        buyTxHash: "0xb", xferTxHash: "0xh" } as any, ctx);
    expect(v.status).toBe("PASS");
  });
});

describe("interpretHiddenFee — the sell side", () => {
  // Regression: only the buy was measured, so a token taking its cut on the
  // way out looked clean, and one taking both was reported at half its cost.
  it("FAILs on a sell tax even when buying and transferring are free", () => {
    const v = interpretHiddenFee(
      { sent: "1000", received: "1000", buyTaxBps: 0, sellTaxBps: 900, sellMeasured: true,
        feeBps: 0, buyTxHash: "0xb", sellTxHash: "0xs", xferTxHash: "0xh" } as any, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toMatch(/9% on sell/i);
    expect(v.numbers.sellTaxPct).toBe("9%");
    expect(v.txHashes).toContain("0xs");
  });

  it("names both sides when a token charges each way", () => {
    const v = interpretHiddenFee(
      { sent: "1000", received: "1000", buyTaxBps: 299, sellTaxBps: 294, sellMeasured: true,
        feeBps: 0, buyTxHash: "0xb", sellTxHash: "0xs", xferTxHash: "0xh" } as any, ctx);
    expect(v.title).toContain("2.99% on buy");
    expect(v.title).toContain("2.94% on sell");
  });

  it("says the sell was not measured rather than reporting 0%", () => {
    const v = interpretHiddenFee(
      { sent: "1000", received: "1000", buyTaxBps: 0, sellTaxBps: 0, sellMeasured: false,
        feeBps: 0, buyTxHash: "0xb", xferTxHash: "0xh" } as any, ctx);
    expect(v.numbers.sellTaxPct).toBe("n/a");
    expect(v.rows.some((r) => /could not complete a test sell/i.test(r.proven))).toBe(true);
  });
});

// Regression: a honeypot whose sell reverts cannot have its sell side
// measured, and the verdict claimed "no hidden fee on buying, selling or
// transferring" anyway — reassurance about the exact thing that was broken,
// on a card whose own row said the sell could not be tested.
it("does not claim a clean sell when the sell was never measured", () => {
  const v = interpretHiddenFee(
    { sent: "1000", received: "1000", buyTaxBps: 0, sellTaxBps: 0, sellMeasured: false,
      feeBps: 0, buyTxHash: "0xb", xferTxHash: "0xh" } as any, ctx);
  expect(v.status).toBe("PASS");
  expect(v.title).not.toMatch(/selling/i);
  expect(v.title).toMatch(/could not be measured/i);
});
