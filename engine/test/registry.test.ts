import { describe, it, expect } from "vitest";
import { PROBES } from "../src/probes/registry";

describe("registry", () => {
  // These ids are not internal labels. They key every recorded run in
  // @sidik/shared, they are what the catalogue filters on, and they are what
  // the planner offers the model. Renaming or reordering one silently
  // invalidates 194 stored verdicts, so the list is pinned here on purpose.
  it("exposes exactly the probes the recorded runs were keyed by", () => {
    expect(PROBES.map((p) => p.id)).toEqual([
      "honeypot", "hiddenFee", "approvalDrain", "lpRug", "crossVenue", "ownerTrap",
    ]);
  });

  it("gives every probe a unique id", () => {
    expect(new Set(PROBES.map((p) => p.id)).size).toBe(PROBES.length);
  });

  // A probe reaching the registry without one of these does not fail at
  // registration — it fails mid-run, inside a fork, as an NA that reads like
  // a finding about the token.
  it("gives every probe the full contract the orchestrator calls", () => {
    for (const p of PROBES) {
      expect(typeof p.applicableWhen, `${p.id}.applicableWhen`).toBe("function");
      expect(typeof p.setup, `${p.id}.setup`).toBe("function");
      expect(typeof p.execute, `${p.id}.execute`).toBe("function");
      expect(typeof p.interpret, `${p.id}.interpret`).toBe("function");
      expect(p.title, `${p.id}.title`).toBeTruthy();
    }
  });
});
