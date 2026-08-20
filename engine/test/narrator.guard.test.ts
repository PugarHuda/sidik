import { describe, it, expect } from "vitest";
import { allowedHex, allowedNumbers, guardProse } from "../src/narrator.js";

const verdicts = [{ probe: "hiddenFee", numbers: { sent: "1000", feePct: "10%" }, rows: [], txHashes: [] }] as any;

describe("narrator numeric guard", () => {
  it("collects every number appearing in verdicts", () => {
    const a = allowedNumbers(verdicts);
    expect(a.has("1000")).toBe(true);
    expect(a.has("10")).toBe(true); // from "10%"
  });
  it("rejects prose that invents a number not in the verdicts", () => {
    expect(guardProse("The fee is 10% on 1000 tokens.", allowedNumbers(verdicts))).not.toBe("");
    expect(guardProse("The token has 5000 holders.", allowedNumbers(verdicts))).toBe("");
  });
});

describe("guardProse — hex evidence", () => {
  const verdicts = [{
    probe: "honeypot", status: "FAIL" as const, title: "Honeypot",
    rows: [{ label: "Sell", claimed: "Tradable", proven: "Sell reverted", ok: false }],
    numbers: { boughtAmount: "1000" },
    txHashes: ["0xAbCd12" as `0x${string}`],
  }];

  // The digits inside a tx hash used to read as invented figures, so quoting
  // the run's own strongest evidence killed every narration.
  it("keeps prose that quotes a tx hash from the run", () => {
    const out = guardProse("Sell reverted; see 0xabcd12 for 1000 tokens.",
      allowedNumbers(verdicts), allowedHex(verdicts));
    expect(out).toContain("0xabcd12");
  });

  it("rejects a tx hash that never appeared in the run", () => {
    const out = guardProse("See 0xdeadbeef.", allowedNumbers(verdicts), allowedHex(verdicts));
    expect(out).toBe("");
  });

  it("still rejects an invented number alongside a real hash", () => {
    const out = guardProse("0xAbCd12 shows a 42% loss.", allowedNumbers(verdicts), allowedHex(verdicts));
    expect(out).toBe("");
  });
});
