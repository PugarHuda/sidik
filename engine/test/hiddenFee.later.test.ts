import { describe, it, expect } from "vitest";
import { interpretHiddenFee } from "../src/probes/hiddenFee.js";
const ctx = {} as any;
const base = { sent: "1000", received: "1000", feeBps: 0, buyTaxBps: 0, sellMeasured: true, xferTxHash: "0xh", sellTxHash: "0xs" };

describe("interpretHiddenFee — the same sell a day later", () => {
  it("a tax that decays is named with both figures", () => {
    const v = interpretHiddenFee({ ...base, sellTaxBps: 3000, sellLaterMeasured: true, sellTaxLaterBps: 0, sellLaterTxHash: "0xl" }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toBe("Hidden fees — 30% on sell (0% a day later)");
    expect(v.numbers.sellTaxLaterPct).toBe("0%");
    expect(v.rows.find((r) => r.label === "Sell back a day later")?.ok).toBe(true);
    expect(v.txHashes).toContain("0xl");
  });

  it("a tax that only appears later is still a fee", () => {
    const v = interpretHiddenFee({ ...base, sellTaxBps: 0, sellLaterMeasured: true, sellTaxLaterBps: 1500 }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toMatch(/0% on sell \(15% a day later\)/);
  });

  it("a stable tax is one number, no extra row", () => {
    const v = interpretHiddenFee({ ...base, sellTaxBps: 500, sellLaterMeasured: true, sellTaxLaterBps: 520 }, ctx);
    expect(v.title).toBe("Hidden fees — 5% on sell");
    expect(v.rows.some((r) => r.label === "Sell back a day later")).toBe(false);
    expect(v.numbers.sellTaxLaterPct).toBe("5.20%");
  });

  it("no tax now or later is a PASS with both measured", () => {
    const v = interpretHiddenFee({ ...base, sellTaxBps: 0, sellLaterMeasured: true, sellTaxLaterBps: 0 }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.numbers.sellTaxLaterPct).toBe("0%");
  });
});
