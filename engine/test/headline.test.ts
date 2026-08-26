import { describe, expect, it } from "vitest";
import { headlineOf, FIXTURES } from "@sidik/shared";

/**
 * The rule that decides the one word a reader acts on.
 *
 * It used to exist twice — once in the run page and once in the catalogue —
 * and two copies of "is this token safe" is one copy too many. Now there is a
 * single function, and this is what holds it to its meaning.
 */
describe("headlineOf", () => {
  const v = (status: "PASS" | "FAIL" | "NA", applicable?: boolean) =>
    applicable === undefined ? { status } : { status, applicable };

  it("says FAIL when anything that could apply did fail", () => {
    expect(headlineOf([v("PASS"), v("FAIL"), v("PASS")])).toBe("FAIL");
  });

  it("says PASS only when every applicable probe passed", () => {
    expect(headlineOf([v("PASS"), v("PASS")])).toBe("PASS");
  });

  it("does not let an inapplicable probe drag the headline down", () => {
    // The V3 LP-rug case: the mechanism does not exist for this token, so it
    // says nothing about it. Counting its NA once summarised 82 clean tokens
    // as unknown.
    expect(headlineOf([v("PASS"), v("NA", false)])).toBe("PASS");
    expect(headlineOf([v("FAIL"), v("NA", false)])).toBe("FAIL");
  });

  it("still says NA when a probe that did apply could not answer", () => {
    expect(headlineOf([v("PASS"), v("NA")])).toBe("NA");
  });

  it("says NA when nothing applied at all, rather than PASS", () => {
    // A token nothing could be tested on is not a token that passed.
    expect(headlineOf([])).toBe("NA");
    expect(headlineOf([v("NA", false)])).toBe("NA");
  });

  it("agrees with itself across every recorded run", () => {
    // Guards the shape as much as the rule: if a run ever carried a verdict
    // this could not read, it would fall out here rather than on the page.
    const seen = new Set<string>();
    for (const run of Object.values(FIXTURES)) {
      const h = headlineOf(run.verdicts);
      expect(["PASS", "FAIL", "NA"]).toContain(h);
      seen.add(h);
    }
    // All three outcomes are actually represented, so this is not passing
    // because every run happens to land in one bucket.
    expect([...seen].sort()).toEqual(["FAIL", "NA", "PASS"]);
  });
});
