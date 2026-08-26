import { describe, expect, it } from "vitest";
import {
  CATALOGUE_FILTERS, catalogueRows, catalogueSummary, filterRows,
  isCatalogueFilter, type CatalogueRow,
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
