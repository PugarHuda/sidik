import { describe, it, expect } from "vitest";
import { interpretHiddenFee } from "../src/probes/hiddenFee.js";
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
    expect(v.title).toMatch(/buy tax of 2.99%/i);
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
