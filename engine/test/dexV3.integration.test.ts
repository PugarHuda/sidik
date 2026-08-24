import { describe, it, expect } from "vitest";
import { withFork } from "../src/fork.js";
import { prescan } from "../src/prescan.js";
import { honeypotProbe } from "../src/probes/honeypot.js";
import { hiddenFeeProbe } from "../src/probes/hiddenFee.js";
import { lpRugProbe } from "../src/probes/lpRug.js";
import { BASE_FORK_BLOCK } from "../src/examples.js";
import type { Hex, ProbeCtx } from "@sidik/shared";

const RUN = !!process.env.BASE_ARCHIVE_RPC;
// anvil dev account #0 — the only kind of sender fork.send() can have anvil sign for.
const TEST_WALLET = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Hex;

// BRETT holds ~300 WETH on Uniswap V3 and under 0.2 on V2. Probing V2 reported
// it as having no liquidity to test, which is the wrong answer about a token
// that trades perfectly well.
const BRETT = "0x532f27101965dd16442E59d40670FaF5eBB142E4" as Hex;
// BRB trades on V2 and taxes both sides — the control for the venue choice.
const BRB = "0x0e86eFe5Ba52336c2173AD69EE726e054619e0d8" as Hex;

async function mkCtx(token: Hex, fork: Parameters<typeof prescan>[0]): Promise<ProbeCtx> {
  const scan = await prescan(fork, token);
  return { token, scan, testWallet: TEST_WALLET, block: BASE_FORK_BLOCK };
}

(RUN ? describe : describe.skip)("Uniswap V3 routing (integration)", () => {
  it("sends a V3-only token to V3 and gets a real verdict, not 'no liquidity'", async () => {
    await withFork(BASE_FORK_BLOCK, async (fork) => {
      const ctx = await mkCtx(BRETT, fork);
      expect(ctx.scan.venue).toBe("v3");
      expect(ctx.scan.hasPool).toBe(true);
      expect(ctx.scan.poolFee).toBeGreaterThan(0);

      await honeypotProbe.setup(fork, ctx);
      const v = honeypotProbe.interpret(await honeypotProbe.execute(fork, ctx), ctx);
      expect(v.status).toBe("PASS");
      // "Could not buy" would mean the swap never happened.
      expect(v.title).not.toMatch(/could not buy/i);
    });
  }, 120_000);

  it("measures the V3 sell rather than quietly skipping it", async () => {
    await withFork(BASE_FORK_BLOCK, async (fork) => {
      const ctx = await mkCtx(BRETT, fork);
      await hiddenFeeProbe.setup(fork, ctx);
      const v = hiddenFeeProbe.interpret(await hiddenFeeProbe.execute(fork, ctx), ctx);
      // "n/a" is what an unmeasured sell reports, and it is what a broken V3
      // sell path would silently produce while still looking like a clean PASS.
      expect(v.numbers.sellTaxPct).not.toBe("n/a");
      expect(v.status).toBe("PASS");
    });
  }, 120_000);

  it("says why LP-rug cannot apply on V3 instead of dropping the card", async () => {
    await withFork(BASE_FORK_BLOCK, async (fork) => {
      const ctx = await mkCtx(BRETT, fork);
      expect(lpRugProbe.applicableWhen(ctx.scan)).toBe(true);
      const v = lpRugProbe.interpret(await lpRugProbe.execute(fork, ctx), ctx);
      expect(v.status).toBe("NA");
      expect(v.title).toMatch(/uniswap v3/i);
    });
  }, 120_000);

  it("still routes a V2 token to V2, so the venue choice is a choice", async () => {
    await withFork(BASE_FORK_BLOCK, async (fork) => {
      const ctx = await mkCtx(BRB, fork);
      expect(ctx.scan.venue).toBe("v2");
      expect(lpRugProbe.applicableWhen(ctx.scan)).toBe(true);
    });
  }, 120_000);
});
