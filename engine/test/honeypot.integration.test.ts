import { describe, it, expect } from "vitest";
import { withFork } from "../src/fork.js";
import { honeypotProbe } from "../src/probes/honeypot.js";
import type { PreScan, ProbeCtx, Hex } from "@sidik/shared";

const RUN = !!process.env.BASE_ARCHIVE_RPC;
const BLOCK = BigInt(process.env.BASE_FORK_BLOCK ?? "0");
const TEST_WALLET = "0x000000000000000000000000000000000000dEaD" as const;

// ponytail: token addresses TODO — pick a confirmed-liquid Base Uniswap V2
// pair (known-safe) and a known honeypot once BASE_ARCHIVE_RPC + a fork
// block are available. `examples.ts` doesn't exist yet (out of Task 5
// scope); wire it in when the controller supplies real addresses.
const SAFE_TOKEN = "0x0000000000000000000000000000000000dEaD" as Hex;
const HONEYPOT_TOKEN = "0x0000000000000000000000000000000000bEEF" as Hex;

function ctxFor(token: Hex): ProbeCtx {
  const scan: PreScan = {
    token, isErc20: true, symbol: "TEST", decimals: 18, hasPool: true, topHolders: [],
  };
  return { token, scan, testWallet: TEST_WALLET, block: BLOCK };
}

// ponytail: gated on BASE_ARCHIVE_RPC — no archive RPC is available yet, so this
// suite skips entirely until one is provided (see task-4-report.md / task-5-report.md).
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
