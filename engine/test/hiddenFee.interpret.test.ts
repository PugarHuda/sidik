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
});
