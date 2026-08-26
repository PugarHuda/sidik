import { describe, expect, it } from "vitest";
import {
  CATALOGUE_FILTERS, CATALOGUE_PAGE_SIZE, catalogueRows, catalogueSummary,
  filterRows, isCatalogueFilter, paginate, type CatalogueRow,
} from "@sidik/shared";

/**
 * The catalogue's filtering, tested as the pure function it is.
 *
 * It used to live inside a client component, where the only way to exercise
 * it was to drive a browser — so the edge cases below (an empty list, a
 * one-element list, a query that is only whitespace, a 5,000-character
 * query, unicode) were never checked at all.
 */
const row = (over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  address: "0x0000000000000000000000000000000000000001",
  symbol: "AAA",
  venue: "v2",
  probes: [{ id: "honeypot", status: "PASS", applicable: true }],
  headline: "PASS",
  finding: "Not a honeypot",
  listedAs: null,
  sharesSymbolWith: 0,
  ...over,
});

const all = { filter: "all", query: "" } as const;

describe("filterRows", () => {
  it("returns everything when nothing is asked for", () => {
    const rows = [row(), row({ address: "0x2" })];
    expect(filterRows(rows, all)).toHaveLength(2);
  });

  it("handles an empty catalogue without throwing", () => {
    expect(filterRows([], all)).toEqual([]);
    expect(filterRows([], { filter: "honeypot", query: "x" })).toEqual([]);
  });

  it("handles a one-row catalogue", () => {
    expect(filterRows([row()], all)).toHaveLength(1);
  });

  it("keeps only rows where that probe actually failed", () => {
    const failed = row({
      address: "0x2", headline: "FAIL",
      probes: [{ id: "honeypot", status: "FAIL", applicable: true }],
    });
    // A row that ran the probe and passed must not appear under its filter.
    const out = filterRows([row(), failed], { filter: "honeypot", query: "" });
    expect(out).toHaveLength(1);
    expect(out[0]?.address).toBe("0x2");
  });

  it("does not count a probe that could not apply as a failure", () => {
    const na = row({
      headline: "PASS",
      probes: [{ id: "lpRug", status: "NA", applicable: false }],
    });
    expect(filterRows([na], { filter: "lpRug", query: "" })).toEqual([]);
  });

  it("treats a whitespace-only query as no query", () => {
    expect(filterRows([row()], { filter: "all", query: "   " })).toHaveLength(1);
  });

  it("matches symbol and address case-insensitively", () => {
    const r = row({ symbol: "Brett", address: "0xABCDEF0000000000000000000000000000000001" });
    expect(filterRows([r], { filter: "all", query: "brett" })).toHaveLength(1);
    expect(filterRows([r], { filter: "all", query: "BRETT" })).toHaveLength(1);
    expect(filterRows([r], { filter: "all", query: "0xabcdef" })).toHaveLength(1);
  });

  it("returns nothing rather than everything for a query that matches nothing", () => {
    // The failure mode that matters: a filter that silently gives up and
    // shows the full list would tell a reader their search succeeded.
    expect(filterRows([row()], { filter: "all", query: "zzzznope" })).toEqual([]);
  });

  it("survives a very long query and unicode without throwing", () => {
    expect(filterRows([row()], { filter: "all", query: "z".repeat(5000) })).toEqual([]);
    expect(filterRows([row()], { filter: "all", query: "柴犬" })).toEqual([]);
    expect(filterRows([row()], { filter: "all", query: "🐸" })).toEqual([]);
    // A regex metacharacter must be matched literally, not compiled.
    expect(() => filterRows([row()], { filter: "all", query: "a(.*)+$" })).not.toThrow();
    expect(filterRows([row()], { filter: "all", query: ".*" })).toEqual([]);
  });

  it("composes the filter and the query rather than letting one win", () => {
    const failed = row({
      address: "0x2", symbol: "ZZZ", headline: "FAIL",
      probes: [{ id: "honeypot", status: "FAIL", applicable: true }],
    });
    expect(filterRows([row(), failed], { filter: "honeypot", query: "AAA" })).toEqual([]);
    expect(filterRows([row(), failed], { filter: "honeypot", query: "ZZZ" })).toHaveLength(1);
  });
});

describe("isCatalogueFilter", () => {
  it("accepts every filter the UI offers", () => {
    for (const f of CATALOGUE_FILTERS) expect(isCatalogueFilter(f.id)).toBe(true);
  });

  it("rejects anything else, including undefined and prototype keys", () => {
    for (const bad of [undefined, "", "nope", "constructor", "__proto__", "toString"]) {
      expect(isCatalogueFilter(bad), `${bad} must not be accepted`).toBe(false);
    }
  });
});

describe("the real catalogue", () => {
  const rows = catalogueRows();

  it("puts failures first", () => {
    const firstPass = rows.findIndex((r) => r.headline === "PASS");
    const lastFail = rows.map((r) => r.headline).lastIndexOf("FAIL");
    expect(lastFail).toBeLessThan(firstPass);
  });

  it("gives every row a finding line rather than an empty cell", () => {
    for (const r of rows) expect(r.finding.length, r.address).toBeGreaterThan(0);
  });

  it("summarises the same set it lists", () => {
    const s = catalogueSummary(rows);
    expect(s.total).toBe(rows.length);
    expect(s.onV2 + s.onV3).toBeLessThanOrEqual(s.total);
    expect(s.failing).toBe(rows.filter((r) => r.headline === "FAIL").length);
  });

  it("filters the real catalogue down without emptying it", () => {
    const honeypots = filterRows(rows, { filter: "honeypot", query: "" });
    expect(honeypots.length).toBeGreaterThan(0);
    expect(honeypots.length).toBeLessThan(rows.length);
  });
});

describe("paginate", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => row({ address: `0x${i}` }));

  it("bounds a page to the page size", () => {
    const p = paginate(many(194), 1);
    expect(p.rows).toHaveLength(CATALOGUE_PAGE_SIZE);
    expect(p.total).toBe(194);
    expect(p.pageCount).toBe(4);
    expect([p.from, p.to]).toEqual([1, 50]);
  });

  it("reports the right window on a middle page", () => {
    const p = paginate(many(194), 3);
    expect([p.from, p.to]).toEqual([101, 150]);
  });

  it("gives the last page only what is left", () => {
    const p = paginate(many(194), 4);
    expect(p.rows).toHaveLength(44);
    expect([p.from, p.to]).toEqual([151, 194]);
  });

  it("clamps past the end rather than returning an empty page", () => {
    // A hand-typed ?page=9999 must not render a catalogue that looks empty.
    const p = paginate(many(194), 9999);
    expect(p.page).toBe(4);
    expect(p.rows.length).toBeGreaterThan(0);
  });

  it("clamps nonsense to the first page", () => {
    for (const bad of [0, -1, -9999, NaN, 0.5]) {
      const p = paginate(many(60), bad);
      expect(p.page, String(bad)).toBe(1);
      expect(p.rows.length, String(bad)).toBeGreaterThan(0);
    }
  });

  it("handles an empty list without dividing by zero", () => {
    const p = paginate([], 1);
    expect(p).toMatchObject({ rows: [], page: 1, pageCount: 1, total: 0, from: 0, to: 0 });
  });

  it("handles a list that fits exactly on one page", () => {
    const p = paginate(many(CATALOGUE_PAGE_SIZE), 1);
    expect(p.pageCount).toBe(1);
    expect(p.to).toBe(CATALOGUE_PAGE_SIZE);
  });

  it("covers every row exactly once across all pages", () => {
    // The property that matters: paging must not drop or duplicate evidence.
    const rows = many(194);
    const seen: string[] = [];
    for (let n = 1; n <= paginate(rows, 1).pageCount; n++) {
      seen.push(...paginate(rows, n).rows.map((r) => r.address));
    }
    expect(seen).toHaveLength(194);
    expect(new Set(seen).size).toBe(194);
  });
});
