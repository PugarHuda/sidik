import { describe, it, expect, vi } from "vitest";
import type { PreScan, Verdict } from "@sidik/shared";

// The gateway is the one dependency Sidik cannot control at demo time. Both
// LLM calls must degrade to their deterministic fallback rather than throw.
vi.mock("ai", () => ({
  generateObject: () => Promise.reject(new Error("AI Gateway requires a valid credit card on file")),
  generateText: () => Promise.reject(new Error("AI Gateway requires a valid credit card on file")),
}));

const { planProbes } = await import("../src/planner.js");
const { narrate } = await import("../src/narrator.js");

const scan: PreScan = {
  token: "0x48F617e5b1B214a90800348D7944bBc0E9290Fbb",
  isErc20: true, symbol: "Anastasia", decimals: 8, hasPool: true, topHolders: [],
};

describe("LLM outage", () => {
  it("plans every applicable probe when the gateway is unavailable", async () => {
    const ids = await planProbes(scan);
    expect(ids).toContain("honeypot");
    expect(ids).toContain("hiddenFee");
    // approvalDrain targets wallets, not tokens — it must stay out.
    expect(ids).not.toContain("approvalDrain");
  });

  it("narrates from the verdicts themselves when the gateway is unavailable", async () => {
    const verdicts: Verdict[] = [{
      probe: "honeypot", status: "FAIL", title: "Honeypot — you can buy but cannot sell",
      rows: [], numbers: {}, txHashes: [],
    }];
    const text = await narrate(verdicts);
    expect(text).toContain("Honeypot — you can buy but cannot sell");
  });
});
