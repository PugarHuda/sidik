import { describe, expect, it } from "vitest";
import type { ProbeCtx } from "@sidik/shared";
import { interpretOwnerTrap } from "../src/probes/ownerTrap";
import { OWNER_SWITCHES, UNLOCK_SELECTOR, UPGRADE_SELECTORS, callData } from "../src/selectors";
import { parseOtherVenues } from "../src/prescan";

/**
 * The interpretations added for proxies, fee ladders and fake renounces.
 * Pure functions over the raw result, so every branch is a table entry.
 */
const ctx: ProbeCtx = {
  token: "0x0000000000000000000000000000000000000001",
  scan: { token: "0x0000000000000000000000000000000000000001", isErc20: true, symbol: "TKN", decimals: 18, hasPool: true, topHolders: [] },
  testWallet: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  block: 1n,
};
const WETH_1 = "1000000000000000000";
const base = {
  searched: 30, owner: "0x00000000000000000000000000000000000000aA", renounced: false, noOwnerFn: false,
  found: ["setFees(uint256,uint256)"], buyTxHash: "0x01", baselineSellHash: "0x02", baselineReceived: WETH_1,
};

describe("interpretOwnerTrap — proxies", () => {
  it("an executed upgrade that breaks the sell is a FAIL naming the admin", () => {
    const v = interpretOwnerTrap({
      ...base, calls: [{ sig: "upgradeTo(address)", ok: true }], found: [],
      implementation: "0x00000000000000000000000000000000000000ee", proxyAdmin: "0x00000000000000000000000000000000000000ad",
      upgraded: true, upgradeTxHash: "0x03", upgradeSellHash: "0x04", upgradeSellReverted: true, upgradeSellReason: "execution reverted",
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toMatch(/proxy admin replaced the token's code and the sell stopped working/);
    expect(v.rows[0]!.proven).toContain("0x00000000000000000000000000000000000000ad");
    expect(v.numbers.proxyAdmin).toBe("0x00000000000000000000000000000000000000ad");
    expect(v.numbers.implementation).toBe("0x00000000000000000000000000000000000000ee");
    expect(v.txHashes).toEqual(["0x01", "0x02", "0x03", "0x04"]);
  });

  it("an upgrade the sell survives is a PASS, still recorded as executed", () => {
    const v = interpretOwnerTrap({
      ...base, calls: [{ sig: "upgradeTo(address)", ok: true }], found: [], proxyAdmin: "0x00000000000000000000000000000000000000ad",
      upgraded: true, upgradeSellReverted: false, upgradeReceived: WETH_1,
    }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.rows[0]!.ok).toBe(true);
  });

  it("a blocked sell still wins over the upgrade result", () => {
    const v = interpretOwnerTrap({
      ...base, calls: [{ sig: "pause()", ok: true }], found: ["pause()"],
      blockTried: true, blockReverted: true, blockReason: "paused", upgraded: true, upgradeSellReverted: true,
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toMatch(/pulled pause\(\)/);
  });
});

describe("interpretOwnerTrap — fee ladder", () => {
  it("a fee accepted at 25% is a FAIL even though the sell kept 75%", () => {
    const v = interpretOwnerTrap({
      ...base, calls: [{ sig: "setFees(uint256,uint256)", ok: true, feePct: 25 }],
      blockTried: true, blockReverted: false, blockReceived: "750000000000000000",
    }, ctx);
    expect(v.status).toBe("FAIL");
    expect(v.title).toMatch(/set the fee to 25% on demand/);
    expect(v.numbers.feeSetTo).toBe("25% via setFees(uint256,uint256)");
    expect(v.numbers.proceedsKept).toBe("75%");
  });

  it("a fee accepted at 10% that barely moves the sell stays a PASS", () => {
    const v = interpretOwnerTrap({
      ...base, calls: [{ sig: "setFees(uint256,uint256)", ok: true, feePct: 10 }],
      blockTried: true, blockReverted: false, blockReceived: "900000000000000000",
    }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.numbers.feeSetTo).toBe("10% via setFees(uint256,uint256)");
  });

  it("a 25% fee whose sell paid the same as before is not blamed on the fee", () => {
    // The contract accepted the value but the sell path ignored it: the
    // kept-percentage guard keeps this out of the fee verdict.
    const v = interpretOwnerTrap({
      ...base, calls: [{ sig: "setFees(uint256,uint256)", ok: true, feePct: 25 }],
      blockTried: true, blockReverted: false, blockReceived: WETH_1,
    }, ctx);
    expect(v.status).toBe("PASS");
  });
});

describe("interpretOwnerTrap — renounce variants", () => {
  it("renounced with unlock() in the bytecode is NA, not PASS", () => {
    const v = interpretOwnerTrap({
      ...base, owner: "0x00000000000000000000000000000000005A1Dec", renounced: true, unlockPresent: true,
      calls: [{ sig: "setFees(uint256,uint256)", ok: false, reason: "Ownable: caller is not the owner" }],
    }, ctx);
    expect(v.status).toBe("NA");
    expect(v.title).toMatch(/timed lock, not a renounce/);
    expect(v.numbers.unlockPresent).toBe("unlock() is in the bytecode");
  });

  it("renounced without unlock() remains a PASS with evidence", () => {
    const v = interpretOwnerTrap({
      ...base, owner: "0x00000000000000000000000000000000005A1Dec", renounced: true,
      calls: [{ sig: "setFees(uint256,uint256)", ok: false, reason: "Ownable: caller is not the owner" }],
    }, ctx);
    expect(v.status).toBe("PASS");
    expect(v.rows[0]!.proven).toMatch(/an address nobody can sign for/);
  });

  it("an owner that is a contract is named as one", () => {
    const v = interpretOwnerTrap({
      ...base, ownerIsContract: true, calls: [{ sig: "pause()", ok: true }], found: ["pause()"],
      blockTried: true, blockReverted: true, blockReason: "paused",
    }, ctx);
    expect(v.title).toMatch(/^The owner \(a contract\) pulled pause\(\)/);
    expect(v.numbers.ownerIsContract).toBe("yes");
  });
});

describe("selectors — ladders, templates, upgrade and unlock", () => {
  it("every fee setter carries a descending ladder that starts where the old single try was", () => {
    const fee = OWNER_SWITCHES.filter((s) => /fee|tax/i.test(s.sig));
    expect(fee.length).toBeGreaterThanOrEqual(8);
    for (const s of fee) {
      expect(s.ladder, s.sig).toBeDefined();
      expect(s.ladder![0]!.feePct).toBe(99);
      expect(s.ladder!.map((r) => r.feePct)).toEqual([99, 49, 30, 25, 20, 15, 10]);
    }
  });

  it("a ladder rung encodes as the switch's own selector", () => {
    const s = OWNER_SWITCHES.find((x) => x.sig === "updateSellFees(uint256,uint256,uint256)")!;
    const data = callData(s, ctx.testWallet, ctx.testWallet, 1n, s.ladder![3]!.args);
    expect(data.startsWith(s.selector)).toBe(true);
    // The three parts sum to the rung's percentage.
    const [a, b, c] = s.ladder![3]!.args as bigint[];
    expect(Number(a! + b! + c!)).toBe(25);
  });

  it("the template names the catalogue lacked are searched for", () => {
    const sigs = OWNER_SWITCHES.map((s) => s.sig);
    for (const sig of ["setBots(address[],bool)", "enableTrading(bool)", "setMaxWallet(uint256)", "updateBuyFees(uint256,uint256,uint256)"]) {
      expect(sigs).toContain(sig);
    }
  });

  it("the unlock and upgrade selectors are the well-known values", () => {
    expect(UNLOCK_SELECTOR).toBe("0xa69df4b5");
    expect(UPGRADE_SELECTORS.upgradeTo).toBe("0x3659cfe6");
    expect(UPGRADE_SELECTORS.upgradeToAndCall).toBe("0x4f1ef286");
  });
});

describe("prescan — other venues from DEX Screener", () => {
  it("keeps venue, pair and rounded depth, deepest first, at most five", () => {
    const body = [
      { dexId: "aerodrome", pairAddress: "0x00000000000000000000000000000000000000a1", liquidity: { usd: 784123.4 } },
      { dexId: "uniswap", pairAddress: "0x00000000000000000000000000000000000000a2", liquidity: { usd: 1160000 } },
      { dexId: "sushiswap", pairAddress: "not-an-address", liquidity: { usd: 5 } },
      { dexId: "", pairAddress: "0x00000000000000000000000000000000000000a3" },
      ...Array.from({ length: 6 }, (_, i) => ({ dexId: `dex${i}`, pairAddress: `0x00000000000000000000000000000000000000b${i}`, liquidity: { usd: i } })),
    ];
    const out = parseOtherVenues(body);
    expect(out.length).toBe(5);
    expect(out[0]).toEqual({ dex: "uniswap", pair: "0x00000000000000000000000000000000000000a2", liquidityUsd: 1160000 });
    expect(out[1]).toEqual({ dex: "aerodrome", pair: "0x00000000000000000000000000000000000000a1", liquidityUsd: 784123 });
  });

  it("anything that is not an array is no venues, not a crash", () => {
    expect(parseOtherVenues({ error: "rate limited" })).toEqual([]);
    expect(parseOtherVenues(null)).toEqual([]);
  });
});
