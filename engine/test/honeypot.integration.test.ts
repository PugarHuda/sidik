import { ANVIL_ACCOUNT_0 } from "../src/base";
import { describe, it, expect } from "vitest";
import { withFork } from "../src/fork";
import { honeypotProbe } from "../src/probes/honeypot";
import type { PreScan, ProbeCtx, Hex } from "@sidik/shared";
import { BASE_FORK_BLOCK } from "../src/forkBlock";

const RUN = !!process.env.BASE_ARCHIVE_RPC;
const BLOCK = BASE_FORK_BLOCK;
// anvil dev account #0 — fork.send() has anvil sign for the sender, which it
// only does for its own funded accounts (same wallet the orchestrator uses).
const TEST_WALLET = ANVIL_ACCOUNT_0;

// Both confirmed against a real fork at BASE_FORK_BLOCK on 2026-08-20 (see
// examples.ts for how the honeypot was found and what it does).
const SAFE_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex;      // USDC (Base)
const HONEYPOT_TOKEN = "0x48F617e5b1B214a90800348D7944bBc0E9290Fbb" as Hex;  // Anastasia

function ctxFor(token: Hex): ProbeCtx {
  const scan: PreScan = {
    token, isErc20: true, symbol: "TEST", decimals: 18, hasPool: true, topHolders: [],
  };
  return { token, scan, testWallet: TEST_WALLET, block: BLOCK };
}

// Gated on BASE_ARCHIVE_RPC: skips when no archive RPC is configured.
(RUN ? describe : describe.skip)("honeypotProbe (integration)", () => {
  it("PASSes on a known-safe Base token", async () => {
    const ctx = ctxFor(SAFE_TOKEN);
    await withFork(BLOCK, async (fork) => {
      await honeypotProbe.setup(fork, ctx);
      const raw = await honeypotProbe.execute(fork, ctx);
      const verdict = honeypotProbe.interpret(raw, ctx);
      expect(verdict.status).toBe("PASS");
    });
  }, 90_000);

  it("FAILs on a known honeypot", async () => {
    const ctx = ctxFor(HONEYPOT_TOKEN);
    await withFork(BLOCK, async (fork) => {
      await honeypotProbe.setup(fork, ctx);
      const raw = await honeypotProbe.execute(fork, ctx);
      const verdict = honeypotProbe.interpret(raw, ctx);
      expect(verdict.status).toBe("FAIL");
    });
  }, 90_000);
});
