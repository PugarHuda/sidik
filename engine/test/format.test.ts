import { describe, it, expect } from "vitest";
import { amount } from "../src/format.js";

describe("amount", () => {
  it("reads a raw 18-decimal balance as a person would", () => {
    expect(amount("10702235470409660775853120", 18, "BRB")).toBe("10,702,235.47 BRB");
  });

  it("respects a token's own decimals", () => {
    expect(amount("17661591544435", 8)).toBe("176,615.91");
    expect(amount("2240708453", 6, "USDC")).toBe("2,240.7 USDC");
  });

  // Two decimals would round a small holding to 0.00 and say nothing.
  it("keeps significant digits for sub-1 amounts", () => {
    expect(amount("1234500000000000", 18)).toBe("0.001234");
  });

  it("drops a fraction that is all zeros", () => {
    expect(amount("5000000", 6)).toBe("5");
  });

  it("passes through anything that is not a number", () => {
    expect(amount("n/a", 18)).toBe("n/a");
  });
});
