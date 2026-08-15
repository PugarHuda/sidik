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
