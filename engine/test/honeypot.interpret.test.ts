import { describe, it, expect } from "vitest";
import { interpretHoneypot } from "../src/probes/honeypot";

const ctx = { token: "0xtok", scan: {} as any, testWallet: "0xw", block: 1n } as any;

describe("interpretHoneypot", () => {
  it("FAILs when sell reverts (honeypot)", () => {
    const v = interpretHoneypot({
      boughtAmount: "1000", soldOk: false, sellRevertReason: "TRANSFER_FAILED",
      buyTxHash: "0xbuy", sellTxHash: "0xsell",
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.reason).toBe("TRANSFER_FAILED");
    expect(v.rows[0]?.ok).toBe(false);
    expect(v.txHashes).toEqual(["0xbuy", "0xsell"]);
  });

  it("PASSes when the buy-then-sell round trip succeeds", () => {
    const v = interpretHoneypot({
      boughtAmount: "1000", soldOk: true, buyTxHash: "0xbuy", sellTxHash: "0xsell",
    }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.rows[0]?.ok).toBe(true);
  });

  it("is NA when the buy itself failed (no pool / no liquidity)", () => {
    const v = interpretHoneypot({
      boughtAmount: "0", soldOk: false, buyTxHash: "0xbuy", sellTxHash: "0x",
    }, ctx);
    expect(v.status).toBe("NA");
  });
});

describe("interpretHoneypot — proceeds, not just success", () => {
  // Regression: the probe asked only whether the sell reverted. A token that
  // lets the sell through and keeps the proceeds passed both this probe and
  // the fee probe, so nothing in the product caught it.
  it("FAILs when the sell succeeds but pays back almost nothing", () => {
    const v = interpretHoneypot(
      { boughtAmount: "1000", soldOk: true, sellPredicted: "1000000000000000000",
        sellReceived: "1000000000000000", buyTxHash: "0xb", sellTxHash: "0xs" } as any, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toMatch(/pays almost nothing/i);
  });

  it("still PASSes a sell that pays what the pool quoted", () => {
    const v = interpretHoneypot(
      { boughtAmount: "1000", soldOk: true, sellPredicted: "1000000000000000000",
        sellReceived: "994000000000000000", buyTxHash: "0xb", sellTxHash: "0xs" } as any, ctx);
    expect(v.status).toBe("PASS");
  });

  it("does not judge proceeds when the pool never quoted the trade", () => {
    const v = interpretHoneypot(
      { boughtAmount: "1000", soldOk: true, sellPredicted: "0", sellReceived: "0",
        buyTxHash: "0xb", sellTxHash: "0xs" } as any, ctx);
    expect(v.status).toBe("PASS");
  });
});

// Regression: formatting boughtAmount for display turned "0" into "0 SYMBOL",
// so the no-liquidity branch stopped matching and five tokens that could not
// be bought at all were reported as honeypots.
it("is NA, not a honeypot accusation, when the buy acquired nothing", () => {
  const v = interpretHoneypot(
    { boughtAmount: "0", soldOk: false, buyTxHash: "0xb", sellTxHash: "0x" } as any,
    { scan: { decimals: 18, symbol: "DEAI" } } as any);
  expect(v.status).toBe("NA");
  expect(v.numbers.boughtAmount).toBe("0 DEAI");
});

describe("interpretHoneypot — a reverted sell is not the end of the question", () => {
  const v3ctx = { token: "0xtok", scan: { symbol: "T", decimals: 18, venue: "v3" }, testWallet: "0xw", block: 1n } as any;
  const v2ctx = { ...v3ctx, scan: { ...v3ctx.scan, venue: "v2" } };
  const ONE = "1000000000000000000";

  // A max-tx cap is the commonest reason a Base meme token refuses a sell. It
  // costs the holder — leaving takes several transactions — but they can
  // leave, and calling it a honeypot would be a false accusation.
  it("PASSes, and names the cap, when a tenth of the position sells", () => {
    const v = interpretHoneypot({
      boughtAmount: ONE, soldOk: false, sellRevertReason: "Transfer amount exceeds the maxTxAmount",
      sellRetried: true, partialSoldOk: true, partialAmount: "100000000000000000",
      partialReceived: "5000000000000000", buyTxHash: "0xbuy", sellTxHash: "0xs1", partialSellTxHash: "0xs2",
    }, v2ctx);
    expect(v.status).toBe("PASS");
    expect(v.title).toMatch(/sells are capped/i);
    expect(v.numbers.partialSell).toBe("succeeded");
    expect(v.reason).toContain("maxTxAmount");
    expect(v.txHashes).toEqual(["0xbuy", "0xs1", "0xs2"]);
  });

  it("FAILs as a honeypot when both sizes revert and nothing is skimmed", () => {
    const v = interpretHoneypot({
      boughtAmount: ONE, soldOk: false, sellRevertReason: "TransferHelper: TRANSFER_FROM_FAILED",
      sellRetried: true, partialSoldOk: false, partialRevertReason: "TransferHelper: TRANSFER_FROM_FAILED",
      transferSkimBps: 0,
    }, v2ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toBe("Honeypot — you can buy but cannot sell");
    expect(v.rows[0]?.proven).toMatch(/so did selling a tenth/);
    expect(v.numbers.partialSell).toBe("reverted");
    expect(v.numbers.transferSkim).toBe("0%");
  });

  // Uniswap V3 refuses a swap whose input arrives short (IIA). A token that
  // skims transfers therefore cannot be sold into V3 by anyone — the outcome
  // for the holder is identical, the mechanism is not, and the title says so.
  it("names the V3 skim mechanism rather than calling it a trap", () => {
    const v = interpretHoneypot({
      boughtAmount: ONE, soldOk: false, sellRevertReason: "IIA",
      sellRetried: true, partialSoldOk: false, partialRevertReason: "IIA",
      transferSkimBps: 500, skimAmount: "10000000000000000",
    }, v3ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toMatch(/skims 5% off every transfer/);
    expect(v.title).toMatch(/Uniswap V3 rejects/);
    expect(v.title).not.toMatch(/^Honeypot/);
    expect(v.numbers.transferSkim).toBe("5%");
  });

  // The same skim on a V2 pool does not explain a revert: V2's fee-on-transfer
  // router absorbs it. So the mechanism title is V3-only.
  it("does not blame V3 for a revert on a V2 pool", () => {
    const v = interpretHoneypot({
      boughtAmount: ONE, soldOk: false, sellRevertReason: "blocked",
      sellRetried: true, partialSoldOk: false, transferSkimBps: 500,
    }, v2ctx);
    expect(v.title).toBe("Honeypot — you can buy but cannot sell");
  });

  // Runs recorded before the retry existed carry none of the new fields and
  // must read exactly as they did.
  it("reads a pre-retry recording unchanged", () => {
    const v = interpretHoneypot({
      boughtAmount: ONE, soldOk: false, sellRevertReason: "STF", buyTxHash: "0xbuy", sellTxHash: "0xsell",
    }, v3ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toBe("Honeypot — you can buy but cannot sell");
    expect(v.rows[0]?.proven).toBe("Sell reverted");
    expect(v.numbers.partialSell).toBeUndefined();
  });
});
