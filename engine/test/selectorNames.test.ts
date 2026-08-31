import { describe, it, expect } from "vitest";
import { toFunctionSelector } from "viem";
import { nameOf, SELECTOR_NAMES } from "../src/selectorNames";

// The generated table is data; this only proves the generator resolved the
// selectors the owner-trap probe already knows by name.
describe("selectorNames", () => {
  it("names the switches the probe operates", () => {
    expect(nameOf(toFunctionSelector("function pause()"))).toBe("pause()");
    expect(nameOf(toFunctionSelector("function transfer(address,uint256)"))).toBe("transfer(address,uint256)");
    expect(nameOf("0xDEADBEEF")).toBeUndefined();
  });
  it("holds the catalogue's vocabulary, not a handful of entries", () => {
    expect(Object.keys(SELECTOR_NAMES).length).toBeGreaterThan(800);
  });
});
