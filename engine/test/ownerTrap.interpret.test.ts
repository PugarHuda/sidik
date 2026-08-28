import { describe, it, expect } from "vitest";
import { interpretOwnerTrap, STRANGER } from "../src/probes/ownerTrap.js";

const ctx = {
  token: "0xtok",
  scan: { symbol: "SCAM", decimals: 18 } as any,
  testWallet: "0xw",
  block: 1n,
} as any;

const ETH = (n: string) => n; // wei strings, kept literal so the maths is visible
const ONE = "1000000000000000000";

describe("interpretOwnerTrap", () => {
  it("is NA, not PASS, when the bytecode has no switch it knows how to pull", () => {
    const v = interpretOwnerTrap({ noSwitches: true, searched: 19 }, ctx);
    expect(v.status).toBe("NA");
    // The wording has to survive a reader who wants to quote it as "clean".
    expect(v.rows[0]?.proven).toContain("19 known owner switches");
    expect(v.rows[0]?.proven).toMatch(/may still exist under a name Sidik does not know/);
    expect(v.numbers.switchesFound).toBe("none");
  });

  it("is NA when the sell was already broken before the owner did anything", () => {
    const v = interpretOwnerTrap({
      calls: [{ sig: "pause()", ok: false }],
      cannotTest: "The sell already fails before the owner touches anything, so no change could be attributed to a switch",
      buyTxHash: "0xbuy",
    }, ctx);
    expect(v.status).toBe("NA");
    expect(v.txHashes).toEqual(["0xbuy"]);
  });

  it("FAILs when a switch the owner pulled stops the sell reverting-clean", () => {
    const v = interpretOwnerTrap({
      calls: [{ sig: "pause()", ok: true }],
      owner: "0xowner",
      baselineReceived: ONE,
      blockTried: true, blockReverted: true,
      blockReason: "Pausable: paused",
      buyTxHash: "0xbuy", baselineSellHash: "0xs1", blockSellHash: "0xs2",
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toContain("pause()");
    expect(v.reason).toBe("Pausable: paused");
    expect(v.numbers.proceedsAfter).toBe("reverted");
    expect(v.txHashes).toEqual(["0xbuy", "0xs1", "0xs2"]);
  });

  it("FAILs when the sell still goes through but the owner took most of it", () => {
    const v = interpretOwnerTrap({
      calls: [{ sig: "setFees(uint256,uint256)", ok: true }],
      owner: "0xowner",
      baselineReceived: ONE,
      blockReceived: "100000000000000000", // 10%
      blockTried: true, blockReverted: false,
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toContain("lost 90%");
    expect(v.numbers.proceedsKept).toBe("10%");
  });

  // The point of the probe: a token that passes every other check today and
  // still hands one address the power to end it.
  it("PASSes when the owner pulled every switch and the exit survived", () => {
    const v = interpretOwnerTrap({
      calls: [{ sig: "pause()", ok: true }, { sig: "setSwapEnabled(bool)", ok: true }],
      owner: "0xowner",
      baselineReceived: ONE,
      blockReceived: ETH("990000000000000000"),
      blockTried: true, blockReverted: false,
    }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.rows[0]?.ok).toBe(true);
    expect(v.numbers.switchesPulled).toBe("pause(), setSwapEnabled(bool)");
  });

  it("PASSes on renounced ownership only because the calls were tried and reverted", () => {
    const v = interpretOwnerTrap({
      calls: [{ sig: "pause()", ok: false, reason: "Ownable: caller is not the owner" }],
      renounced: true,
      owner: STRANGER,
      baselineReceived: ONE,
      blockReceived: ONE,
    }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.rows[0]?.proven).toContain("an address nobody can sign for");
    expect(v.reason).toContain("Ownable: caller is not the owner");
  });

  // AERO exposes no owner() at all. Saying "owner() is the zero address" about
  // it would assert a read that never happened — and calling it PASS would be
  // a verdict with no evidence, since Sidik never found out who may mint.
  it("is NA, not PASS, when it cannot establish who may pull the switch", () => {
    const v = interpretOwnerTrap({
      calls: [{ sig: "mint(address,uint256)", ok: false, reason: "reverted" }],
      found: ["mint(address,uint256)"],
      renounced: true, noOwnerFn: true, owner: STRANGER,
      baselineReceived: ONE, blockReceived: ONE,
    }, ctx);
    expect(v.status).toBe("NA");
    expect(v.rows[0]?.proven).toContain("exposes no owner()");
    expect(v.rows[0]?.proven).not.toContain("zero address");
    expect(v.rows[0]?.proven).toMatch(/rules out only that anyone can/);
    // It IS an answer about this token, so unlike the no-switch case it must
    // keep counting toward the headline.
    expect(v.applicable).toBeUndefined();
  });

  // A stranger pulling a switch on a token that still has an owner is the
  // worst case of all, and it used to be unreachable: the check only ran where
  // ownership had already been renounced.
  it("FAILs an unguarded switch even on a token that still has an owner", () => {
    const v = interpretOwnerTrap({
      found: ["blacklist(address)"], calls: [],
      renounced: false, owner: "0xowner",
      openToAnyone: "blacklist(address)",
      baselineReceived: ONE,
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toContain("Anyone can call blacklist(address)");
    // The switch it found must still be named, even though no owner call ran.
    expect(v.numbers.switchesFound).toBe("blacklist(address)");
  });

  // Renounced ownership is the usual reassurance; a switch with no owner check
  // at all turns that reassurance inside out.
  it("FAILs when a switch turns out not to be owner-gated at all", () => {
    const v = interpretOwnerTrap({
      calls: [{ sig: "blacklist(address)", ok: true }],
      found: ["blacklist(address)"],
      renounced: true,
      openToAnyone: "blacklist(address)",
      baselineReceived: ONE,
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toContain("Anyone can call blacklist(address)");
  });

  it("FAILs on mint-and-dump by what the exit was worth, not by the supply number", () => {
    const v = interpretOwnerTrap({
      calls: [{ sig: "mint(address,uint256)", ok: true }],
      owner: "0xowner", diluted: true,
      supplyBefore: ONE, supplyAfter: "11000000000000000000",
      baselineReceived: ONE,
      diluteReceived: "10000000000000000", // 1%
      buyTxHash: "0xbuy", dumpTxHash: "0xdump",
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.numbers.minted).toBe("10 SCAM");
    expect(v.numbers.proceedsKept).toBe("1%");
    expect(v.txHashes).toContain("0xdump");
  });

  it("PASSes a mint that the pool absorbed, rather than assuming mint means rug", () => {
    const v = interpretOwnerTrap({
      calls: [{ sig: "mint(address,uint256)", ok: true }],
      owner: "0xowner", diluted: true,
      supplyBefore: ONE, supplyAfter: "11000000000000000000",
      baselineReceived: ONE,
      diluteReceived: "900000000000000000", // 90%
    }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.numbers.proceedsKept).toBe("90%");
  });

  it("PASSes, with the reason attached, when the contract refused its own owner", () => {
    const v = interpretOwnerTrap({
      calls: [{ sig: "setFees(uint256,uint256)", ok: false, reason: "fee exceeds MAX_FEE" }],
      owner: "0xowner",
      baselineReceived: ONE, blockReceived: ONE,
    }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.title).toContain("refused every call");
    expect(v.reason).toContain("MAX_FEE");
  });

  // A zero baseline means there is no ratio to take. Dividing by it produced
  // 0%, which reads as a total loss caused by the owner — the same mistake
  // that once turned USDC into a honeypot.
  it("does not turn an unmeasurable baseline into a 100% loss", () => {
    const v = interpretOwnerTrap({
      calls: [{ sig: "pause()", ok: true }],
      owner: "0xowner",
      baselineReceived: "0", blockReceived: "0",
      blockTried: true, blockReverted: false,
    }, ctx);
    expect(v.status).toBe("NA");
    expect(v.rows[0]?.proven).toMatch(/nothing to compare/i);
  });

  // A revert is a revert whatever the first sell was worth, so the FAIL still
  // stands where the ratio cannot be taken.
  it("still FAILs a sell that went from working to reverting, unmeasurable or not", () => {
    const v = interpretOwnerTrap({
      calls: [{ sig: "pause()", ok: true }],
      owner: "0xowner",
      baselineReceived: "0",
      blockTried: true, blockReverted: true, blockReason: "Pausable: paused",
    }, ctx);
    expect(v.status).toBe("FAIL");
  });

  // A token carrying both kinds of switch used to report only the mint: the
  // second phase overwrote the first, so a contract that could pause you AND
  // dilute you was described as though it could only dilute you.
  it("reports a blocked sell even when the token can also mint", () => {
    const v = interpretOwnerTrap({
      calls: [{ sig: "pause()", ok: true }, { sig: "mint(address,uint256)", ok: true }],
      owner: "0xowner",
      baselineReceived: ONE,
      blockTried: true, blockReverted: true, blockReason: "Pausable: paused",
      diluted: true, supplyBefore: ONE, supplyAfter: "11000000000000000000",
      diluteReceived: "900000000000000000",
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toContain("pause()");
  });

  // The no-switch NA must not drag a token's headline down: it is the absence
  // of a mechanism, not a failure to answer.
  it("marks the no-switch NA inapplicable so it cannot demote a clean token", () => {
    expect(interpretOwnerTrap({ noSwitches: true, searched: 19 }, ctx).applicable).toBe(false);
    // Everything else IS an answer about this token and stays applicable.
    expect(interpretOwnerTrap({
      calls: [{ sig: "pause()", ok: false }], cannotTest: "no position to trap",
    }, ctx).applicable).toBeUndefined();
  });
});
