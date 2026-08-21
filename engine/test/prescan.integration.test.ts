import { describe, it, expect } from "vitest";
import { withFork } from "../src/fork.js";
import { prescan } from "../src/prescan.js";
import type { Hex } from "@sidik/shared";
import { BASE_FORK_BLOCK } from "../src/examples.js";

const RUN = !!process.env.BASE_ARCHIVE_RPC;
const BLOCK = BASE_FORK_BLOCK;

// Base USDC — a real, well-known ERC-20 to sanity-check the core reads against.
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex;
// PEPETO reverts on balanceOf(0x0) but is an ordinary token otherwise, with a
// live Uniswap V2 pool. Probing the zero address used to declare it "not an
// ERC-20", which then routed it to the wallet probe instead of the token ones.
const REVERTS_ON_ZERO = "0x27740c050e3764a2cee00317b7ac68a52d11ab5f" as Hex;
// Reverts on every read, including balanceOf for an ordinary address.
const NOT_A_TOKEN = "0xb2000000000000000000004e6a2de285e265abb6" as Hex;

// Gated on BASE_ARCHIVE_RPC: skips when no archive RPC is configured.
(RUN ? describe : describe.skip)("prescan (integration)", () => {
  it("recognizes Base USDC as an ERC-20", async () => {
    await withFork(BLOCK, async (fork) => {
      const scan = await prescan(fork, USDC);
      expect(scan.isErc20).toBe(true);
      expect(scan.symbol).toBeTruthy();
      expect(scan.decimals).toBeGreaterThan(0);
    });
  }, 90_000);

  it("recognizes a token that reverts on balanceOf(0x0)", async () => {
    await withFork(BLOCK, async (fork) => {
      const scan = await prescan(fork, REVERTS_ON_ZERO);
      expect(scan.isErc20).toBe(true);
      expect(scan.symbol).toBe("PEPETO");
      expect(scan.hasPool).toBe(true);
    });
  }, 90_000);

  it("still rejects an address that is not a token", async () => {
    await withFork(BLOCK, async (fork) => {
      const scan = await prescan(fork, NOT_A_TOKEN);
      expect(scan.isErc20).toBe(false);
    });
  }, 90_000);
});
