import { describe, it, expect } from "vitest";
import { interpretHoneypot } from "../src/probes/honeypot.js";

const ctx = { token: "0xtok", scan: {} as any, testWallet: "0xw", block: 1n } as any;

describe("interpretHoneypot", () => {
  it("FAILs when sell reverts (honeypot)", () => {
    const v = interpretHoneypot({
      boughtAmount: "1000", soldOk: false, sellRevertReason: "TRANSFER_FAILED",
      buyTxHash: "0xbuy", sellTxHash: "0xsell",
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.reason).toBe("TRANSFER_FAILED");
    expect(v.rows[0].ok).toBe(false);
    expect(v.txHashes).toEqual(["0xbuy", "0xsell"]);
  });

  it("PASSes when the buy-then-sell round trip succeeds", () => {
    const v = interpretHoneypot({
      boughtAmount: "1000", soldOk: true, buyTxHash: "0xbuy", sellTxHash: "0xsell",
    }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.rows[0].ok).toBe(true);
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
