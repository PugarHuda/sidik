import { ANVIL_ACCOUNT_0 } from "../src/base.js";
import { describe, it, expect } from "vitest";
import { withFork } from "../src/fork.js";
import { prescan } from "../src/prescan.js";
import { hiddenFeeProbe } from "../src/probes/hiddenFee.js";
import { BASE_FORK_BLOCK } from "../src/forkBlock.js";
import type { Hex, ProbeCtx } from "@sidik/shared";

const RUN = !!process.env.BASE_ARCHIVE_RPC;
// anvil dev account #0 — the only kind of sender fork.send() can have anvil sign for.
const TEST_WALLET = ANVIL_ACCOUNT_0;

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex;
// Taxes the pool route 2.99% each way but never taxes transfer() — see
// shared/src/examples.ts.
const TAXED = "0xB357E2546e51fa6f2383e768A7d022d5777Ba152" as Hex;

async function verdictFor(token: Hex) {
  return withFork(BASE_FORK_BLOCK, async (fork) => {
    const scan = await prescan(fork, token);
    const ctx: ProbeCtx = { token, scan, testWallet: TEST_WALLET, block: BASE_FORK_BLOCK };
    await hiddenFeeProbe.setup(fork, ctx);
    return hiddenFeeProbe.interpret(await hiddenFeeProbe.execute(fork, ctx), ctx);
  });
}

(RUN ? describe : describe.skip)("hiddenFeeProbe (integration)", () => {
  it("PASSes on a bluechip that charges nothing either way", async () => {
    const v = await verdictFor(USDC);
    expect(v.status).toBe("PASS");
    expect(v.numbers.buyTaxPct).toBe("0%");
  }, 90_000);

  // The probe used to test transfer() alone, which this token deliberately
  // leaves untaxed — so it PASSed a token that keeps 2.99% of every buy.
  it("FAILs on a token that taxes the pool route but not transfer()", async () => {
    const v = await verdictFor(TAXED);
    expect(v.status).toBe("FAIL");
    expect(v.numbers.feePct).toBe("0%");
    expect(v.numbers.buyTaxPct).toBe("2.99%");
  }, 90_000);
});
