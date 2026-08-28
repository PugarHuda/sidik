import { describe, it, expect } from "vitest";
import { allowedHex, allowedNumbers, allowedSignatures, guardProse } from "../src/narrator.js";

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

describe("guardProse — function signatures", () => {
  // The owner-trap probe names the exact function it called. Its argument
  // types are digits that are not figures, and leaving them in the allowed set
  // let "256" through as a quantity the model could use to mean anything.
  const verdicts = [{
    probe: "ownerTrap", status: "FAIL" as const,
    title: "The owner pulled mint(address,uint256) and the sell stopped working",
    rows: [{ label: "Owner can trap a holder after the buy", claimed: "Exiting is up to you",
      proven: "The sell returned 0.5 WETH before and reverted after", ok: false }],
    numbers: { switchesPulled: "mint(address,uint256)", switchesSearched: "19" },
    txHashes: [],
  }];

  it("does not let a type width become an allowed figure", () => {
    const allowed = allowedNumbers(verdicts);
    expect(allowed.has("19")).toBe(true);
    expect(allowed.has("0.5")).toBe(true);
    expect(allowed.has("256")).toBe(false);
  });

  it("still keeps prose that quotes the signature the run actually called", () => {
    const out = guardProse(
      "The owner called mint(address,uint256) and the exit stopped working.",
      allowedNumbers(verdicts), allowedHex(verdicts), allowedSignatures(verdicts));
    expect(out).toContain("mint(address,uint256)");
  });

  it("rejects a bare 256 that the signature would once have licensed", () => {
    const out = guardProse("The sell tax rose to 256%.",
      allowedNumbers(verdicts), allowedHex(verdicts), allowedSignatures(verdicts));
    expect(out).toBe("");
  });

  // An unrecognised parenthesised word is ordinary English, not a claim. The
  // guard once rejected 100% of narrations; a rule that throws away "token(s)"
  // would be the same mistake in a new place.
  it("does not throw away prose for an ordinary parenthesised word", () => {
    const out = guardProse("No switch could be pulled by the owner(s).",
      allowedNumbers(verdicts), allowedHex(verdicts), allowedSignatures(verdicts));
    expect(out).not.toBe("");
  });

  it("does not let an unquoted signature launder digits either", () => {
    const out = guardProse("It exposes rugPull(uint512) as well.",
      allowedNumbers(verdicts), allowedHex(verdicts), allowedSignatures(verdicts));
    expect(out).toBe("");
  });
});
