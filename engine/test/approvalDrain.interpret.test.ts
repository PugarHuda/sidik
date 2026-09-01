import { describe, it, expect } from "vitest";
import { interpretApprovalDrain } from "../src/probes/approvalDrain";
const ctx = {} as any;

const ONE_WETH = "1000000000000000000";

describe("interpretApprovalDrain", () => {
  it("FAILs when a live approval is drainable", () => {
    const v = interpretApprovalDrain({
      approvals: [{ spender: "0xsp", allowance: "max", reachableWeth: ONE_WETH }],
      drainedWeth: ONE_WETH, drainTxHash: "0xd",
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.numbers.reachable).toBe("1 WETH");
  });

  it("is NA when there are no approvals to exploit", () => {
    const v = interpretApprovalDrain({ approvals: [], drainedWeth: "0", drainTxHash: "0x" }, ctx);
    expect(v.status).toBe("NA");
  });

  it("FAILs when a real drain happened but the token cannot be priced", () => {
    const v = interpretApprovalDrain({
      approvals: [{ spender: "0xsp", allowance: "max", reachableWeth: "0" }],
      drainedWeth: "0", drainTxHash: "0xd", drained: true,
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.numbers.drained).toBe("unpriced");
  });

  // The value shown used to be tokens priced at a hardcoded $3000/ETH — an
  // invented figure, in a product whose whole claim is that it invents none.
  it("reports value in WETH the pool can quote, never in invented dollars", () => {
    const v = interpretApprovalDrain({
      approvals: [{ spender: "0xsp", allowance: "max", reachableWeth: "250000000000000000" }],
      drainedWeth: "250000000000000000", drainTxHash: "0xd",
    }, ctx);
    expect(v.numbers.reachable).toBe("0.25 WETH");
    expect(JSON.stringify(v)).not.toContain("$");
  });

  // Two of three real wallets lost the whole probe to one contract that
  // reverts on allowance(); the survivors' approvals still deserve a verdict.
  it("counts approvals it had to skip rather than losing the run", () => {
    const v = interpretApprovalDrain({
      approvals: [{ spender: "0xsp", allowance: "max", reachableWeth: ONE_WETH }],
      drainedWeth: ONE_WETH, drainTxHash: "0xd", skipped: 3,
    }, ctx);
    expect(v.numbers.skipped).toBe("3");
    expect(v.status).toBe("FAIL");
  });
});

describe("an address with no contract at the forked block", () => {
  // A token created after the pinned block reads as neither an ERC-20 nor a
  // wallet, and the run used to answer "no live approvals to test" — a
  // statement about a wallet, made about a contract that did not exist yet.
  // Three earlier bugs in this project had the same shape: a technical
  // condition reported as a finding about the token.
  const ctxWith = (hasCode: boolean | undefined) => ({
    token: "0x0000000000000000000000000000000000000001",
    scan: { hasCode },
  }) as never;

  it("says nothing is deployed there, and does not count as a probe that ran", () => {
    const v = interpretApprovalDrain({ approvals: [], reachable: "0", drained: false }, ctxWith(false));
    expect(v.status).toBe("NA");
    expect(v.applicable).toBe(false);
    expect(v.title).toMatch(/nothing is deployed/i);
    expect(v.rows[0]!.proven).toMatch(/today's block/i);
  });

  it("still reports an empty wallet as an empty wallet", () => {
    const v = interpretApprovalDrain({ approvals: [], reachable: "0", drained: false }, ctxWith(true));
    expect(v.title).toMatch(/no live approvals/i);
    expect(v.applicable).not.toBe(false);
  });

  // hasCode is optional, and an older recorded run carries no value for it.
  // Absence must not be read as "no contract".
  it("does not treat an unknown as an absence", () => {
    const v = interpretApprovalDrain({ approvals: [], reachable: "0", drained: false }, ctxWith(undefined));
    expect(v.title).toMatch(/no live approvals/i);
  });
});
