import { describe, it, expect } from "vitest";
import { isAddress, toFunctionSelector } from "viem";
import { OWNER_SWITCHES, callData, selectorsIn, switchesIn } from "../src/selectors";
import {
  ANVIL_ACCOUNT_0, BURN_ADDRESSES, UNISWAP_V2, UNISWAP_V3, WETH, ZERO_ADDRESS,
} from "../src/base";
import { STRANGER } from "../src/probes/ownerTrap";

/** Assemble PUSH4 <selector> the way a solc dispatcher does. */
const push4 = (sel: string) => "63" + sel.slice(2);

describe("selectorsIn", () => {
  it("reads the PUSH4 constants a dispatcher compares against", () => {
    const mint = toFunctionSelector("function mint(address,uint256)");
    const pause = toFunctionSelector("function pause()");
    const code = "0x" + push4(mint) + "80" + push4(pause) + "00";
    expect([...selectorsIn(code)]).toEqual([mint, pause]);
  });

  // The bug this prevents is not a missed selector but an invented one: bytes
  // inside a PUSH32 constant look like opcodes to a naive scan, so the probe
  // would report calling a function the contract never had.
  it("does not read selectors out of the payload of another PUSH", () => {
    const mint = toFunctionSelector("function mint(address,uint256)");
    // PUSH32 whose payload happens to contain 0x63 followed by four bytes.
    const payload = "63" + "40c10f19" + "00".repeat(27);
    expect(payload.length / 2).toBe(32);
    expect(selectorsIn("0x7f" + payload).size).toBe(0);
    // ...and the same bytes outside a PUSH payload are still found.
    expect(selectorsIn("0x" + push4(mint)).has(mint)).toBe(true);
  });

  it("is empty for an address with no code", () => {
    expect(selectorsIn("0x").size).toBe(0);
    expect(selectorsIn("").size).toBe(0);
  });

  it("does not run off the end on a truncated PUSH4", () => {
    expect(selectorsIn("0x6340c1").size).toBe(0);
  });
});

describe("OWNER_SWITCHES", () => {
  it("has a unique, correctly derived selector per signature", () => {
    for (const s of OWNER_SWITCHES) {
      expect(s.selector, s.sig).toBe(toFunctionSelector(`function ${s.sig}`));
    }
    expect(new Set(OWNER_SWITCHES.map((s) => s.selector)).size).toBe(OWNER_SWITCHES.length);
  });

  // Every entry is called with encoded arguments inside a fork. An arity
  // mismatch there surfaces as a revert, which reads as "the contract refused
  // the owner" — a wrong verdict rather than a visible failure.
  it("encodes every switch with the arity its signature declares", () => {
    for (const s of OWNER_SWITCHES) {
      const data = callData(s, ANVIL_ACCOUNT_0, ANVIL_ACCOUNT_0, 1000n);
      expect(data.startsWith(s.selector), s.sig).toBe(true);
      // 4-byte selector plus one 32-byte word per argument. An address[] adds
      // an offset word and a length word on top of its single element.
      const words = (data.length - 2 - 8) / 64;
      const declared = s.sig.slice(s.sig.indexOf("(") + 1, -1);
      const arity = declared === "" ? 0 : declared.split(",").length;
      expect(words, `${s.sig} encoded ${words} words for ${arity} argument(s)`)
        .toBe(declared.includes("[]") ? arity + 2 : arity);
    }
  });

  it("aims the blocking switches at the wallet under test, and mint at the owner", () => {
    const blacklist = OWNER_SWITCHES.find((s) => s.sig === "blacklist(address)")!;
    expect(blacklist.args(ANVIL_ACCOUNT_0, "0xdead" as never, 0n)).toEqual([ANVIL_ACCOUNT_0]);
    const mint = OWNER_SWITCHES.find((s) => s.sig === "mint(address,uint256)")!;
    expect(mint.args("0xvictim" as never, ANVIL_ACCOUNT_0, 7n)).toEqual([ANVIL_ACCOUNT_0, 70n]);
  });

  it("excludes the switches that help a holder rather than trap one", () => {
    const sigs = OWNER_SWITCHES.map((s) => s.sig);
    expect(sigs).not.toContain("removeLimits()");
    expect(sigs).not.toContain("excludeFromFees(address,bool)");
  });
});

describe("switchesIn", () => {
  it("returns only the switches the bytecode carries", () => {
    const mint = OWNER_SWITCHES.find((s) => s.sig === "mint(address,uint256)")!;
    const found = switchesIn("0x" + push4(mint.selector));
    expect(found.map((s) => s.sig)).toEqual(["mint(address,uint256)"]);
  });

  it("finds nothing in bytecode that has none of them", () => {
    expect(switchesIn("0x60806040523480156100")).toEqual([]);
  });
});

describe("hand-written address constants", () => {
  // viem's isAddress is strict by default: it validates the EIP-55 checksum,
  // so a literal typed in the wrong case is rejected at the point of use, deep
  // inside a fork, with a message that talks about length. Every address in
  // this codebase is written by hand from a doc or an explorer, which is
  // exactly how the case gets lost.
  it("are all valid and correctly checksummed", () => {
    const addresses: [string, string][] = [
      ["STRANGER", STRANGER],
      ["ANVIL_ACCOUNT_0", ANVIL_ACCOUNT_0],
      ["WETH", WETH],
      ["ZERO_ADDRESS", ZERO_ADDRESS],
      ["UNISWAP_V2.router", UNISWAP_V2.router],
      ["UNISWAP_V2.factory", UNISWAP_V2.factory],
      ["UNISWAP_V3.factory", UNISWAP_V3.factory],
      ["UNISWAP_V3.quoter", UNISWAP_V3.quoter],
      ["UNISWAP_V3.router", UNISWAP_V3.router],
      ...BURN_ADDRESSES.map((a, i) => [`BURN_ADDRESSES[${i}]`, a] as [string, string]),
    ];
    for (const [name, address] of addresses) {
      expect(isAddress(address), `${name} = ${address}`).toBe(true);
    }
  });
});
