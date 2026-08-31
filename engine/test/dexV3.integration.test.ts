import { ANVIL_ACCOUNT_0 } from "../src/base";
import { describe, it, expect } from "vitest";
import { withFork } from "../src/fork";
import { prescan } from "../src/prescan";
import { honeypotProbe } from "../src/probes/honeypot";
import { hiddenFeeProbe } from "../src/probes/hiddenFee";
import { lpRugProbe } from "../src/probes/lpRug";
import { BASE_FORK_BLOCK } from "../src/forkBlock";
import type { Hex, ProbeCtx } from "@sidik/shared";

const RUN = !!process.env.BASE_ARCHIVE_RPC;
// Generous on purpose. These do real swaps on a real fork, and the sell
// test alone takes ~42s on an idle machine — but every one of these
// numbers is RPC latency, so anything else competing for the same key
// multiplies it. A tight budget here fails on contention, not on code.
const TIMEOUT_MS = 300_000;
// anvil dev account #0 — the only kind of sender fork.send() can have anvil sign for.
const TEST_WALLET = ANVIL_ACCOUNT_0;

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
  }, TIMEOUT_MS);

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
  }, TIMEOUT_MS);

  // V3 liquidity is pullable through the position manager exactly as V2 LP
  // is through the router, so the probe no longer declines on V3: it finds
  // the largest recent position, classifies its owner and pulls it. What it
  // must never do again is hand a V3 token an "applicable: false" that lifts
  // its headline.
  it("pulls a V3 position instead of declaring LP-rug inapplicable", async () => {
    await withFork(BASE_FORK_BLOCK, async (fork) => {
      const ctx = await mkCtx(BRETT, fork);
      expect(lpRugProbe.applicableWhen(ctx.scan)).toBe(true);
      const v = lpRugProbe.interpret(await lpRugProbe.execute(fork, ctx), ctx);
      expect(v.applicable).not.toBe(false);
      expect(v.title).not.toMatch(/does not apply/i);
      expect(v.numbers.venue).toBe("uniswap-v3");
      expect(["PASS", "FAIL", "NA"]).toContain(v.status);
      // Whatever it found, it says what: a holder kind, a position, or the
      // precise reason none could be pulled.
      expect(v.rows[0]?.proven.length ?? 0).toBeGreaterThan(20);
    });
  }, TIMEOUT_MS);

  it("still routes a V2 token to V2, so the venue choice is a choice", async () => {
    await withFork(BASE_FORK_BLOCK, async (fork) => {
      const ctx = await mkCtx(BRB, fork);
      expect(ctx.scan.venue).toBe("v2");
      expect(lpRugProbe.applicableWhen(ctx.scan)).toBe(true);
    });
  }, TIMEOUT_MS);
});
