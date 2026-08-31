import { describe, it, expect } from "vitest";
import { createPublicClient, http, parseEther } from "viem";
import { base } from "viem/chains";
import { withFork } from "../src/fork";
import { BASE_FORK_BLOCK } from "../src/forkBlock";

const RUN = !!process.env.BASE_ARCHIVE_RPC;
const BLOCK = BASE_FORK_BLOCK;
// Kept in step with bingx.integration.test.ts, and asserted below.
export const FORK_BLOCK_UNIX = 1787189347;

// Gated on BASE_ARCHIVE_RPC: these spawn a real anvil fork against a real
// archive node, so they skip where no key is configured — CI without the
// secret, and any fresh clone. (The note that once stood here said no archive
// RPC existed yet; one has for days.)
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

  /**
   * The pinned block's timestamp, tied to the block itself.
   *
   * crossVenue prices the pool against the venue candle covering this moment,
   * and the BingX suite hardcodes the same number so it can query without
   * spawning a fork. That constant was wrong by exactly one hour — every
   * figure reasoned from it described the 00:00 candle while the probe read
   * the 01:00 one, which is how VIRTUAL came to hold a PASS derived from an
   * hour in which it did not trade at all.
   *
   * A hardcoded timestamp that nothing checks is a constant waiting to drift.
   * This is the check.
   */
  it("pins the block timestamp the cross-venue comparison is built on", async () => {
    await withFork(BLOCK, async (fork) => {
      const pub = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });
      const block = await pub.getBlock({ blockNumber: BLOCK });
      expect(block.number).toBe(BLOCK);
      expect(
        Number(block.timestamp),
        "bingx.integration.test.ts hardcodes this timestamp — update it there too",
      ).toBe(FORK_BLOCK_UNIX);
    });
  }, 60_000);
});
