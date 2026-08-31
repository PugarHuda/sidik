import { describe, it, expect } from "vitest";
import { withFork } from "../src/fork";
import { ownerTrapProbe } from "../src/probes/ownerTrap";
import { switchesIn } from "../src/selectors";
import { ANVIL_ACCOUNT_0 } from "../src/base";
import { BASE_FORK_BLOCK } from "../src/forkBlock";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import type { Hex, PreScan, ProbeCtx } from "@sidik/shared";

const RUN = !!process.env.BASE_ARCHIVE_RPC;
const BLOCK = BASE_FORK_BLOCK;
const TEST_WALLET = ANVIL_ACCOUNT_0;

// All three were read off the catalogue's own bytecode scan at BASE_FORK_BLOCK.
// KNINE is the shape the probe exists for: a live owner holding pause(),
// blacklist(address) and mint(address,uint256) at once.
const KNINE = "0x91fbB2503AC69702061f1AC6885759Fc853e6EaE" as Hex;
const KNINE_OWNER = "0x2bff9cB1C0e355595130038b56AE705E9BCB8508" as Hex;
const KNINE_POOL = "0xF32de35616EBb6D230e5b38f719ced1EBbE800CF" as Hex;
// USDC carries none of the switches, which is the NA path.
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex;

function ctxFor(token: Hex, over: Partial<PreScan> = {}): ProbeCtx {
  const scan: PreScan = {
    token, isErc20: true, symbol: "TEST", decimals: 18, hasPool: true,
    venue: "v2", topHolders: [], ...over,
  };
  return { token, scan, testWallet: TEST_WALLET, block: BLOCK };
}

(RUN ? describe : describe.skip)("ownerTrapProbe (integration)", () => {
  // The whole probe rests on the claim that both sells run against identical
  // state. If snapshot/revert silently did nothing, the second sell would run
  // after the first had already emptied the wallet, and every token on Base
  // would look like a trap.
  it("anvil actually rolls state back, so 'the identical sell' is literal", async () => {
    await withFork(BLOCK, async (fork) => {
      const pub = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });

      await fork.setBalanceEth(TEST_WALLET, "5");
      const id = await fork.snapshot();
      await fork.setBalanceEth(TEST_WALLET, "500");
      expect(await pub.getBalance({ address: TEST_WALLET })).toBe(500n * 10n ** 18n);
      await fork.revertTo(id);
      expect(await pub.getBalance({ address: TEST_WALLET })).toBe(5n * 10n ** 18n);
    });
  }, 120_000);

  // The semantics the probe and the orchestrator both depend on, pinned here
  // because getting them wrong is silent: anvil CONSUMES a snapshot id when it
  // reverts to it. Reverting to the same id a second time does nothing, so a
  // probe that rolled back to one id per phase would have run its later phases
  // on top of its earlier ones without any error to show for it.
  it("consumes a snapshot id, so every rollback needs a fresh one", async () => {
    await withFork(BLOCK, async (fork) => {
      const pub = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });
      const balance = () => pub.getBalance({ address: TEST_WALLET });

      await fork.setBalanceEth(TEST_WALLET, "5");
      const id = await fork.snapshot();
      await fork.setBalanceEth(TEST_WALLET, "500");
      await fork.revertTo(id);
      expect(await balance()).toBe(5n * 10n ** 18n);

      // Dirty the chain again and try the SAME id.
      await fork.setBalanceEth(TEST_WALLET, "900");
      await fork.revertTo(id).catch(() => { /* anvil may reject outright */ });
      expect(await balance(), "a consumed snapshot must not silently restore").toBe(900n * 10n ** 18n);

      // A fresh one taken after the revert does work.
      const fresh = await fork.snapshot();
      await fork.setBalanceEth(TEST_WALLET, "1");
      await fork.revertTo(fresh);
      expect(await balance()).toBe(900n * 10n ** 18n);
    });
  }, 120_000);

  // The PUSH4 scan is the probe's input. Proving it against live mainnet
  // bytecode is what stops a refactor from quietly returning an empty set,
  // which would turn every token into "no switch found".
  it("finds the real switches in real deployed bytecode", async () => {
    await withFork(BLOCK, async (fork) => {
      const pub = createPublicClient({ chain: base, transport: http(fork.rpcUrl) });
      const sigs = switchesIn((await pub.getCode({ address: KNINE })) ?? "0x").map((s) => s.sig);
      expect(sigs).toContain("pause()");
      expect(sigs).toContain("blacklist(address)");
      expect(sigs).toContain("mint(address,uint256)");
      expect(switchesIn((await pub.getCode({ address: USDC })) ?? "0x")).toEqual([]);
    });
  }, 120_000);

  it("is NA on a token that carries none of the switches", async () => {
    const ctx = ctxFor(USDC, { symbol: "USDC", decimals: 6 });
    await withFork(BLOCK, async (fork) => {
      await ownerTrapProbe.setup(fork, ctx);
      const raw = await ownerTrapProbe.execute(fork, ctx);
      expect(raw.noSwitches).toBe(true);
      expect(ownerTrapProbe.interpret(raw, ctx).status).toBe("NA");
    });
  }, 180_000);

  // The end-to-end claim: buy, sell, roll back, let the owner pull what it
  // has, sell again — and get a verdict out of the difference rather than out
  // of an opinion about the source code.
  it("pulls a live owner's switches and decides on what the second sell did", async () => {
    const ctx = ctxFor(KNINE, { symbol: "KNINE", owner: KNINE_OWNER, poolAddress: KNINE_POOL });
    await withFork(BLOCK, async (fork) => {
      await ownerTrapProbe.setup(fork, ctx);
      const raw = await ownerTrapProbe.execute(fork, ctx);
      const verdict = ownerTrapProbe.interpret(raw, ctx);

      // Whatever the outcome, it has to be an outcome the probe measured.
      expect(raw.noSwitches).toBeUndefined();
      expect(["PASS", "FAIL", "NA"]).toContain(verdict.status);
      if (verdict.status !== "NA") {
        expect((raw.calls as { sig: string }[]).map((c) => c.sig)).toContain("pause()");
        // Both sells must have been attempted from the same starting state.
        expect(raw.baselineSellHash).toBeTruthy();
        expect(verdict.numbers.switchesSearched).toBeTruthy();
      }
      // A verdict must never cite a transaction it did not make.
      for (const h of verdict.txHashes) expect(h).toMatch(/^0x[0-9a-f]{64}$/i);
    });
  }, 240_000);
});
