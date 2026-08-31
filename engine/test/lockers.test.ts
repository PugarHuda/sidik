import { describe, it, expect } from "vitest";
import { isAddress, toFunctionSelector } from "viem";
import { classifyHolder, isoDate, UNCX_V2_LOCKER, UNCX_V3_LOCKER } from "../src/lockers";
import { interpretLpRug } from "../src/probes/lpRug";

const ctx = {} as any;
const EOA = "0x1111111111111111111111111111111111111111" as const;

describe("classifyHolder", () => {
  it("treats no code as a wallet", () => {
    expect(classifyHolder(EOA, undefined)).toBe("eoa");
    expect(classifyHolder(EOA, "0x")).toBe("eoa");
  });

  // EIP-7702: 23 bytes, 0xef0100 + delegate. Eight of the catalogue's LP
  // holders look like this and every one is still a person's key.
  it("treats a 7702 delegation designator as a wallet", () => {
    expect(classifyHolder(EOA, "0xef0100" + "22".repeat(20) as `0x${string}`)).toBe("eoa-7702");
  });

  it("recognises a Safe proxy by masterCopy() in its bytecode", () => {
    const sel = toFunctionSelector("function masterCopy()").slice(2);
    expect(sel).toBe("a619486e");
    expect(classifyHolder(EOA, `0x6080${sel}5b00` as `0x${string}`)).toBe("safe");
  });

  it("recognises the UNCX lockers by address, whatever their code", () => {
    expect(classifyHolder(UNCX_V2_LOCKER, "0x6080")).toBe("uncx-locker");
    expect(classifyHolder(UNCX_V3_LOCKER.toUpperCase().replace("0X", "0x") as `0x${string}`, "0x6080")).toBe("uncx-locker");
  });

  it("calls any other code a contract", () => {
    expect(classifyHolder(EOA, "0x60806040")).toBe("contract");
  });

  it("locker constants are well-formed addresses", () => {
    expect(isAddress(UNCX_V2_LOCKER)).toBe(true);
    expect(isAddress(UNCX_V3_LOCKER)).toBe(true);
  });

  it("formats an unlock timestamp as a date", () => {
    expect(isoDate(1_800_000_000n)).toBe("2027-01-15");
  });
});

describe("interpretLpRug with a classified holder", () => {
  const base = {
    lpHolderFound: true, ownerLpPct: 100, burnedLpPct: 0,
    holderValueBefore: "500", holderValueAfter: "500", pullTxHash: "0x",
  };

  // The old behaviour impersonated the locker and "pulled" — a FAIL the locker
  // exists to prevent.
  it("PASSes on LP held by the UNCX locker, naming the unlock date", () => {
    const v = interpretLpRug({ ...base, lpOwner: UNCX_V2_LOCKER, holderKind: "uncx-locker", lockUnlockDate: "2027-01-15", lockedPct: 97.5 }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.title).toBe("LP locked until 2027-01-15 in UNCX — could not be pulled");
    expect(v.numbers.lockUnlockDate).toBe("2027-01-15");
    expect(v.numbers.lockedPct).toBe("97.5%");
    expect(v.numbers.lpHolderKind).toBe("uncx-locker");
    expect(v.txHashes).toEqual([]);
  });

  it("is NA, not FAIL, when an unrecognised contract holds the LP", () => {
    const v = interpretLpRug({ ...base, lpOwner: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", holderKind: "contract" }, ctx);
    expect(v.status).toBe("NA");
    expect(v.title).toMatch(/held by contract 0xabcd…abcd; pulling it needs that contract's own logic/);
  });

  it("keeps the FAIL for a Safe but says who can pull", () => {
    const v = interpretLpRug({ ...base, lpOwner: "0xsafe", holderKind: "safe", holderValueAfter: "3", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toBe("LP rug possible — a Safe multisig can pull all liquidity");
    expect(v.numbers.lpHolderKind).toBe("safe");
  });

  it("notes a 7702 wallet without changing the verdict", () => {
    const v = interpretLpRug({ ...base, lpOwner: "0xo", holderKind: "eoa-7702", holderValueAfter: "3", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.numbers.lpHolderKind).toBe("eoa-7702");
  });

  it("leaves the plain-wallet numbers unchanged (recorded runs still read)", () => {
    const v = interpretLpRug({ ...base, lpOwner: "0xo", holderValueAfter: "3", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("FAIL");
    expect(Object.keys(v.numbers).sort()).toEqual(["burnedLpPct", "holderValueAfter", "holderValueBefore", "lpOwner", "ownerLpPct"]);
  });
});

describe("interpretLpRug on Uniswap V3", () => {
  const base = {
    venue: "v3", lpHolderFound: true, ownerLpPct: 92, burnedLpPct: 0, positionId: "1234567",
    holderValueBefore: "500", holderValueAfter: "500", pullTxHash: "0x",
  };

  it("FAILs when pulling the largest position collapsed a holder", () => {
    const v = interpretLpRug({ ...base, lpOwner: "0xo", holderValueAfter: "12", pullTxHash: "0xp" }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.applicable).toBeUndefined();
    expect(v.numbers.venue).toBe("uniswap-v3");
    expect(v.numbers.positionId).toBe("1234567");
    expect(v.rows[0]!.proven).toMatch(/92% of active liquidity/);
  });

  it("is NA with the precise reason when no position was minted in the window", () => {
    const v = interpretLpRug({ ...base, lpHolderFound: false, ownerLpPct: 0, positionId: "", noPositionReason: "No position with liquidity was minted into this pool in the last 9,000 blocks (0 mints seen)" }, ctx);
    expect(v.status).toBe("NA");
    expect(v.applicable).toBeUndefined();
    expect(v.rows[0]!.proven).toMatch(/9,000 blocks/);
  });

  it("PASSes a position parked at a burn address", () => {
    const v = interpretLpRug({ ...base, lpOwner: "0x000000000000000000000000000000000000dEaD", burnedLpPct: 100 }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.title).toMatch(/burned/);
  });

  it("PASSes a position held by the UNCX V3 locker", () => {
    const v = interpretLpRug({ ...base, lpOwner: UNCX_V3_LOCKER, holderKind: "uncx-locker" }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.title).toBe("LP is held by the UNCX locker — could not be pulled");
  });

  // The pre-V3-pull shape, still in recorded runs until they are re-recorded.
  it("still reads the old 'does not apply' raw shape", () => {
    const v = interpretLpRug({ notApplicable: "v3" }, ctx);
    expect(v.status).toBe("NA");
    expect(v.applicable).toBe(false);
  });
});
