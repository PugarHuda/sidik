import { describe, it, expect } from "vitest";
import { withFork } from "../src/fork.js";
import { prescan } from "../src/prescan.js";
import type { Hex } from "@sidik/shared";

const RUN = !!process.env.BASE_ARCHIVE_RPC;
const BLOCK = BigInt(process.env.BASE_FORK_BLOCK ?? "0");

// Base USDC — a real, well-known ERC-20 to sanity-check the core reads against.
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex;

// ponytail: gated on BASE_ARCHIVE_RPC — no archive RPC is available yet, so this
// suite skips entirely until one is provided (see task-4-report.md / task-5-report.md).
(RUN ? describe : describe.skip)("prescan (integration)", () => {
  it("recognizes Base USDC as an ERC-20", async () => {
    await withFork(BLOCK, async (fork) => {
      const scan = await prescan(fork, USDC);
      expect(scan.isErc20).toBe(true);
      expect(scan.symbol).toBeTruthy();
      expect(scan.decimals).toBeGreaterThan(0);
      // USDC may or may not have a Uniswap V2 pool against WETH on Base (it
      // trades mostly on V3/Aerodrome) — pool assertions need a confirmed
      // example token, picked in the RPC batch alongside a honeypot example.
    });
  }, 90_000);
});
