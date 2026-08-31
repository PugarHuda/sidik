import { describe, it, expect } from "vitest";
import { encodeFunctionData, parseAbi, toFunctionSelector, type Hex } from "viem";
import { RELEASE_SWITCHES, RELEASES_SEARCHED, releaseData, releasesIn } from "../src/lpRelease";
import { lockerName } from "../src/lockers";

const OWNER = "0x1111111111111111111111111111111111111111" as Hex;
const TOKEN = "0x2222222222222222222222222222222222222222" as Hex;
const POSITION = 5_575_073n;

/** A dispatcher carrying exactly these selectors, the shape solc emits. */
const bytecodeWith = (sigs: string[]) =>
  "0x" + sigs.map((s) => "63" + toFunctionSelector(`function ${s}`).slice(2) + "1461").join("");

describe("releasesIn", () => {
  it("finds only the ways out the bytecode actually carries", () => {
    const found = releasesIn(bytecodeWith(["withdraw(uint256)", "owner()"]));
    expect(found.map((r) => r.sig)).toEqual(["withdraw(uint256)"]);
  });

  it("finds nothing in a contract that exposes none", () => {
    expect(releasesIn(bytecodeWith(["owner()", "collect(uint256)"]))).toEqual([]);
    expect(releasesIn("0x")).toEqual([]);
  });

  // The distinction the table is built on. Every one of these appears on the
  // holder contracts, and calling one moves trading fees rather than the
  // position — so "the owner called it and nothing moved" would be a fact
  // about the wrong function.
  it("never treats a fee collector as a way out", () => {
    const feeShaped = ["collect(uint256)", "collectFees(address)", "claimFees(address)", "collectRewards(uint256)"];
    expect(releasesIn(bytecodeWith(feeShaped))).toEqual([]);
    for (const r of RELEASE_SWITCHES) expect(r.sig).not.toMatch(/^(collect|claim)/);
  });
});

describe("releaseData", () => {
  // Each signature gets the argument that would actually hand the liquidity
  // over: the position id for the NFT-shaped ones, the LP asset and a
  // recipient for the ERC-20-shaped ones. An argument in the wrong slot is a
  // revert, and a revert here is published as "the contract refused".
  it("addresses the position by id where the call takes one", () => {
    const w = RELEASE_SWITCHES.find((r) => r.sig === "withdraw(uint256)")!;
    expect(releaseData(w, OWNER, POSITION, TOKEN)).toBe(
      encodeFunctionData({ abi: parseAbi(["function withdraw(uint256)"]), args: [POSITION] }),
    );
  });

  it("sends the LP asset to the owner where the call takes a recipient", () => {
    const r = RELEASE_SWITCHES.find((x) => x.sig === "release(address[],address)")!;
    expect(releaseData(r, OWNER, POSITION, TOKEN)).toBe(
      encodeFunctionData({ abi: parseAbi(["function release(address[],address)"]), args: [[TOKEN], OWNER] }),
    );
  });

  it("encodes every entry in the table without throwing", () => {
    for (const r of RELEASE_SWITCHES) expect(releaseData(r, OWNER, POSITION, TOKEN)).toMatch(/^0x[0-9a-f]+$/);
    expect(RELEASES_SEARCHED).toBe(RELEASE_SWITCHES.length);
  });
});

describe("lockerName", () => {
  // Being on this list turns an unanswered pool into a PASS, so the addresses
  // are asserted verbatim rather than trusted to a refactor.
  it("names the lockers, case-insensitively, and nothing else", () => {
    expect(lockerName("0x25c9c4b56e820e0dea438b145284f02d9ca9bd52")).toBe("UniV3LPLocker");
    expect(lockerName("0x25C9C4B56E820E0DEA438B145284F02D9CA9BD52")).toBe("UniV3LPLocker");
    expect(lockerName("0xc4e637d37113192f4f1f060daebd7758de7f4131")).toBe("UNCX");
    expect(lockerName("0x231278edd38b00b07fbd52120cef685b9baebcc1")).toBe("UNCX");
    expect(lockerName("0xb1900f41d78d330a2a35c6771b3a6088a1b51309")).toBeUndefined();
  });
});
