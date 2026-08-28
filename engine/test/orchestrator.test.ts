import { ANVIL_ACCOUNT_0 } from "../src/base.js";
import { describe, it, expect } from "vitest";
import { runSidik, type RunEvent } from "../src/orchestrator.js";
import type { ForkClient, Hex, PreScan } from "@sidik/shared";

const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex; // checksum-valid (USDC on Base)
const TEST_WALLET = ANVIL_ACCOUNT_0;

const scan: PreScan = {
  token: TOKEN,
  isErc20: true,
  symbol: "TST",
  decimals: 18,
  hasPool: true,
  topHolders: [],
};

// Stub ForkClient: honeypot probe's buy-then-sell round trip, all succeeding,
// driven purely off canned reads/sends — no network.
function makeStubFork(): ForkClient {
  const balances = [0n, 1000n, 1000n]; // buy-before, buy-after, sellAll-amount
  let i = 0;
  return {
    rpcUrl: "http://fake",
    impersonate: async () => {},
    stopImpersonate: async () => {},
    setBalanceEth: async () => {},
    // Answer by function, not by call order: the router quote and the
    // balanceOf sequence are independent, and blindly counting calls made
    // this stub silently re-map every balance the moment a probe added a read.
    read: async (args: any) => {
      if (args?.functionName === "getAmountsOut") return [0n, 1000n] as unknown as any;
      return balances[Math.min(i++, balances.length - 1)] as unknown as any;
    },
    send: async () => ({ hash: "0xhash" as Hex, reverted: false }),
    advance: async () => {},
    // Isolation between probes is now a snapshot rather than a new process.
    // The stub counts them so the test can assert every probe got one and
    // gave it back — a probe that keeps its state would poison the next one.
    snapshot: async () => { snapshots.push("snap"); return `snap${snapshots.length}`; },
    revertTo: async (id) => { reverts.push(id); },
    // Counted so the test can prove a probe cannot leave an account
    // impersonated for whatever runs next on the same fork.
    clearImpersonations: async () => { cleared++; },
  };
}

// Recorded by the stub above, asserted below.
let snapshots: string[] = [];
let reverts: string[] = [];
let cleared = 0;

describe("runSidik", () => {
  it("emits prescan -> plan -> (probe:start, verdict)xN -> narration -> done, and turns a probe throw into an NA verdict", async () => {
    snapshots = []; reverts = []; cleared = 0;
    let closed = 0;
    const events: RunEvent[] = [];
    const fork = makeStubFork();
    // The second probe's snapshot throws, which stands in for anything that
    // can break mid-probe. The run must survive it and keep going.
    let snaps = 0;
    const failing = {
      ...fork,
      snapshot: async () => {
        snaps++;
        if (snaps === 2) throw new Error("fork exploded");
        return fork.snapshot();
      },
    };

    for await (const ev of runSidik(TOKEN, {
      block: 1n,
      testWallet: TEST_WALLET,
      prescan: async () => scan,
      planProbes: async () => ["honeypot", "hiddenFee"],
      narrate: async () => "summary text",
      openFork: async () => ({ fork: failing, close: () => { closed++; } }),
      getCached: () => undefined,
      setCached: () => {},
    })) {
      events.push(ev);
    }

    // One fork for the whole run, and it is closed exactly once.
    expect(closed).toBe(1);

    expect(events.map((e) => e.type)).toEqual([
      "prescan", "plan", "probe:start", "verdict", "probe:start", "verdict", "narration", "done",
    ]);

    const verdicts = events.filter((e): e is RunEvent & { type: "verdict" } => e.type === "verdict")
      .map((e) => e.verdict);
    expect(verdicts[0]?.probe).toBe("honeypot");
    expect(verdicts[0]?.status).toBe("PASS");
    expect(verdicts[1]?.probe).toBe("hiddenFee");
    expect(verdicts[1]?.status).toBe("NA"); // fork threw -> NA, run continued
    expect(verdicts[1]?.title).toMatch(/hiddenFee/);

    const narration = events.find((e) => e.type === "narration");
    expect(narration && (narration as any).text).toBe("summary text");

    // The probe that ran took a snapshot and gave it back. The one whose
    // snapshot threw has nothing to roll back, and must not roll back
    // somebody else's.
    expect(reverts).toEqual(["snap1"]);
    // Both probes, including the one whose snapshot threw: an impersonation
    // left behind by a probe that failed is exactly the one worth clearing.
    expect(cleared).toBe(2);
  });

  // The whole reason a probe can share a fork with the next one: whatever it
  // did to the chain is undone before the next one starts.
  it("rolls the chain back after every probe, including one that threw", async () => {
    snapshots = []; reverts = []; cleared = 0;
    const fork = makeStubFork();
    const exploding = {
      ...fork,
      // Snapshot succeeds, the probe itself blows up afterwards.
      read: async () => { throw new Error("probe exploded"); },
    };
    for await (const _ of runSidik(TOKEN, {
      block: 1n,
      testWallet: TEST_WALLET,
      prescan: async () => scan,
      planProbes: async () => ["honeypot", "hiddenFee"],
      narrate: async () => "summary",
      openFork: async () => ({ fork: exploding, close: () => {} }),
      getCached: () => undefined,
      setCached: () => {},
    })) { /* drain */ }
    expect(reverts).toEqual(["snap1", "snap2"]);
    expect(cleared).toBe(2);
  });

  it("replays a cached run without opening a fork or calling prescan/planProbes/narrate", async () => {
    const cached = {
      scan,
      ids: ["honeypot"],
      verdicts: [{ probe: "honeypot", status: "PASS", title: "cached", rows: [], numbers: {}, txHashes: [] }],
      narration: "cached narration",
    };
    const events: RunEvent[] = [];
    for await (const ev of runSidik(TOKEN, {
      block: 1n,
      getCached: <T,>() => cached as unknown as T,
      setCached: () => { throw new Error("should not set cache on hit"); },
      openFork: async () => { throw new Error("should not fork on cache hit"); },
      prescan: async () => { throw new Error("should not prescan on cache hit"); },
      planProbes: async () => { throw new Error("should not plan on cache hit"); },
      narrate: async () => { throw new Error("should not narrate on cache hit"); },
    })) {
      events.push(ev);
    }
    expect(events.map((e) => e.type)).toEqual(["prescan", "plan", "verdict", "narration", "done"]);
  });
});
