import { describe, it, expect } from "vitest";
import { createPublicClient, http, parseEther } from "viem";
import { base } from "viem/chains";
import { withFork } from "../src/fork.js";
import { BASE_FORK_BLOCK } from "../src/forkBlock.js";

const RUN = !!process.env.BASE_ARCHIVE_RPC;
const BLOCK = BASE_FORK_BLOCK;

// ponytail: gated on BASE_ARCHIVE_RPC — no archive RPC is available yet, so this
// suite skips entirely until one is provided (see task-4-report.md).
(RUN ? describe : describe.skip)("withFork", () => {
  it("forks Base and can set + read an ETH balance", async () => {
    const addr = "0x000000000000000000000000000000000000dEaD" as const;

    await withFork(BLOCK, async (fork) => {
      await fork.setBalanceEth(addr, "5");

      const pub = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });
      const bal = await pub.getBalance({ address: addr });
      expect(bal).toBe(parseEther("5"));
    });
  }, 60_000);
});
