import { describe, it, expect } from "vitest";
import { PROBES, PROBE_IDS } from "../src/probes/registry.js";
describe("registry", () => {
  it("exposes all four MVP probes with unique ids", () => {
    expect(PROBE_IDS).toEqual(["honeypot", "hiddenFee", "approvalDrain", "lpRug"]);
    expect(new Set(PROBES.map((p) => p.id)).size).toBe(4);
  });
});
