import { describe, it, expect } from "vitest";
import { PROBES, PROBE_IDS } from "../src/probes/registry.js";

describe("registry", () => {
  it("exposes every probe with a unique id", () => {
    expect(PROBE_IDS).toEqual(["honeypot", "hiddenFee", "approvalDrain", "lpRug", "crossVenue"]);
    expect(new Set(PROBES.map((p) => p.id)).size).toBe(PROBES.length);
  });

  // PROBE_IDS is the planner's enum. A probe missing from it can never be
  // chosen by the model, and one listed without an implementation would make
  // the planner offer something that cannot run.
  it("keeps the planner's id list in step with the probes themselves", () => {
    expect(PROBE_IDS).toEqual(PROBES.map((p) => p.id));
  });
});
