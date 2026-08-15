import { describe, it, expect } from "vitest";
import { allowedNumbers, guardProse } from "../src/narrator.js";

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
