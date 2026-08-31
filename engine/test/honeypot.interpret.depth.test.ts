import { describe, it, expect } from "vitest";
import { interpretHoneypot } from "../src/probes/honeypot";

const ctx = { token: "0xtok", scan: { decimals: 18, symbol: "T" } as any, testWallet: "0xw", block: 1n } as any;
const bought = { boughtAmount: "1000", buyTxHash: "0xbuy" };

describe("interpretHoneypot — what execution can tell apart", () => {
  it("a reverted buy against a funded pool is a FAIL with the reason, not 'no liquidity'", () => {
    const v = interpretHoneypot({
      boughtAmount: "0", soldOk: false, buyTxHash: "0xbuy", sellTxHash: "0x",
      buyReverted: true, buyRevertReason: "Trading not enabled", buyAttempts: "3", poolWeth: "5000000000000000000",
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toMatch(/Pool holds 5 WETH but the buy reverted \(Trading not enabled\)/);
    expect(v.numbers.buyAttempts).toBe("3");
  });

  it("a reverted buy against an empty pool stays NA", () => {
    const v = interpretHoneypot({
      boughtAmount: "0", soldOk: false, buyTxHash: "0xbuy", sellTxHash: "0x", buyReverted: true, poolWeth: "0",
    }, ctx);
    expect(v.status).toBe("NA");
  });

  it("a sell that only works after the chain moves on is a cooldown, and says so", () => {
    const v = interpretHoneypot({
      ...bought, soldOk: false, sellRevertReason: "cooldown", sellTxHash: "0xsell",
      sellRetried: true, partialSoldOk: false, cooldownTried: true,
      cooldownSoldAfter: "1h", cooldownReceived: "10", cooldownSellTxHash: "0xcool",
    }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.title).toMatch(/cooldown/);
    expect(v.title).toMatch(/after 1h/);
    expect(v.numbers.cooldownSell).toBe("succeeded after 1h");
    expect(v.txHashes).toContain("0xcool");
  });

  it("a sell that still reverts a day later is a honeypot, and the day is on the card", () => {
    const v = interpretHoneypot({
      ...bought, soldOk: false, sellRevertReason: "no", sellTxHash: "0xsell",
      sellRetried: true, partialSoldOk: false, partialRevertReason: "no", cooldownTried: true,
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.rows[0]?.proven).toMatch(/again 24h later/);
    expect(v.numbers.cooldownSell).toBe("reverted after 24h");
  });

  it("the buyer selling while a transferee cannot is a honeypot", () => {
    const v = interpretHoneypot({
      ...bought, soldOk: true, sellTxHash: "0xsell",
      transfereeSellTried: true, transfereeSoldOk: false, transfereeRevertReason: "not whitelisted", transfereeSellTxHash: "0xt",
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toMatch(/buyer can sell, a wallet it transferred to cannot/);
    expect(v.rows[1]?.label).toBe("Sell from a wallet that received a transfer");
    expect(v.rows[1]?.ok).toBe(false);
    expect(v.reason).toBe("not whitelisted");
  });

  it("a transferee that sold is a second green row on a PASS", () => {
    const v = interpretHoneypot({
      ...bought, soldOk: true, sellTxHash: "0xsell", transfereeSellTried: true, transfereeSoldOk: true,
    }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.rows).toHaveLength(2);
    expect(v.rows[1]?.ok).toBe(true);
    expect(v.numbers.transfereeSell).toBe("succeeded");
  });

  it("a transfer that reverted is not blamed on the transferee's sell", () => {
    const v = interpretHoneypot({
      ...bought, soldOk: true, sellTxHash: "0xsell", transfereeSellTried: true, transfereeSoldOk: false, transferReverted: true,
    }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.rows[1]?.proven).toMatch(/transfer itself reverted/);
  });
});
