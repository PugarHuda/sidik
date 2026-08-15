import { describe, it, expect } from "vitest";
import { interpretApprovalDrain } from "../src/probes/approvalDrain.js";
const ctx = {} as any;
describe("interpretApprovalDrain", () => {
  it("FAILs when a live approval is drainable", () => {
    const v = interpretApprovalDrain({
      approvals: [{ spender: "0xsp", allowance: "max", reachableUsd: "1293" }],
      drainedUsd: "1293", drainTxHash: "0xd",
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.numbers.reachableUsd).toBe("$1,293");
  });
  it("is NA when there are no approvals to exploit", () => {
    const v = interpretApprovalDrain({ approvals: [], drainedUsd: "0", drainTxHash: "0x" }, ctx);
    expect(v.status).toBe("NA");
  });
});
